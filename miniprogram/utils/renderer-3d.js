/**
 * STADIACAD 3D WebGL Immersive Stadium & Concert Stage Engine
 * Pure Native WebGL1 implementation for WeChat Mini Program <canvas type="webgl">
 *
 * Modular Architecture:
 * - Mat4: 4x4 matrix mathematics (./engine-3d-mat4)
 * - MeshBuilder: typed geometry synthesizer (./engine-3d-mesh-builder)
 * - AngleMixin: angular discretization (./engine-3d-angle)
 * - InfieldMixin: pitch, track, modules & ground shell (./engine-3d-infield)
 * - StandMixin: tiers, VIP suites & vomitories (./engine-3d-stand)
 * - CanopyMixin: stadium canopy rim & saddle curves (./engine-3d-canopy)
 * - StageMixin: concert stage, LEDs, trusses & catwalk (./engine-3d-stage)
 * - RaycastMixin: screen-to-seat ray intersection (./engine-3d-raycaster)
 */

const {
  DEG2RAD,
  RAD2DEG,
  rotateXZ,
  evalTierPoint,
  isConcentricMorphTier,
  getTierRowsAtAngleFloat,
  getTierRowsAtAngle,
  getInfieldCornerTransitionAngles,
  getRowInwardNormal,
  getRayRoundedRectDistance,
  computeRunningTrackSpec,
  getStageTransform,
  computeVomitoryAngularBounds,
  generateConcertInfieldBlocks
} = require('./schema-geometry');
const { hexToSeat3D, parseHexRgb } = require('./seat-colors');

const { Mat4 } = require('./engine-3d-mat4');
const { MeshBuilder } = require('./engine-3d-mesh-builder');
const { AngleMixin } = require('./engine-3d-angle');
const { CanopyMixin } = require('./engine-3d-canopy');
const { StageMixin } = require('./engine-3d-stage');
const { InfieldMixin } = require('./engine-3d-infield');
const { StandMixin } = require('./engine-3d-stand');
const { RaycastMixin } = require('./engine-3d-raycaster');
const { SceneManager } = require('./scenes/index.js');

const VERTEX_SHADER = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  attribute vec4 aColor;
  attribute vec2 aUv;
  attribute vec4 aInstPosWidth;
  attribute vec3 aInstDirDepth;
  attribute vec3 aInstPanCol;
  attribute vec3 aInstBackCol;
  uniform mat4 uMVP;
  uniform float uIsInstancedSeat;
  varying vec3 vNormal;
  varying vec4 vColor;
  varying vec3 vWorldPos;
  varying vec2 vUv;

  void main() {
    vUv = aUv;
    if (uIsInstancedSeat > 0.5) {
      vec3 localPos = vec3(aPosition.x * aInstPosWidth.w, aPosition.y, aPosition.z * aInstDirDepth.z);
      float fx = aInstDirDepth.x;
      float fz = aInstDirDepth.y;
      float rx = -fz;
      float rz = fx;
      vec3 worldPos = aInstPosWidth.xyz + vec3(
        localPos.x * rx + localPos.z * fx,
        localPos.y,
        localPos.x * rz + localPos.z * fz
      );
      vNormal = vec3(
        aNormal.x * rx + aNormal.z * fx,
        aNormal.y,
        aNormal.x * rz + aNormal.z * fz
      );
      vec3 tint = aColor.a < 0.5 ? vec3(1.0) : (aColor.a < 1.5 ? aInstPanCol : aInstBackCol);
      vColor = vec4(aColor.rgb * tint, 1.0);
      vWorldPos = worldPos;
      gl_Position = uMVP * vec4(worldPos, 1.0);
      return;
    }
    vNormal = aNormal;
    vColor = aColor;
    vWorldPos = aPosition;
    gl_Position = uMVP * vec4(aPosition, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  varying vec3 vNormal;
  varying vec4 vColor;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uIsUnlit;
  uniform float uUseTex;
  uniform sampler2D uLedTex;
  uniform vec3 uCamEye;
  uniform float uLightsOff;
  uniform vec3 uStagePos;
  uniform float uStageGlow;

  void main() {
    if (uUseTex > 0.5) {
      gl_FragColor = texture2D(uLedTex, vUv);
      return;
    }
    if (uIsUnlit > 0.5) {
      gl_FragColor = vColor;
      return;
    }
    float normLen = length(vNormal);
    vec3 norm = normLen > 0.0001 ? (vNormal / normLen) : vec3(0.0, 1.0, 0.0);
    // Pure matte non-reflective shading: soft hemisphere + gentle wrapped diffuse, zero specular glare
    float hemi = 0.5 + 0.5 * norm.y;
    float wrap = max(0.0, (dot(norm, normalize(vec3(0.24, 0.94, 0.24))) + 0.65) / 1.65);
    float baseLighting = 0.68 + 0.18 * hemi + 0.12 * wrap;
    // Attenuate high-frequency normal contrast at bird's-eye distances to suppress seat moiré
    float camDist = length(vWorldPos - uCamEye);
    float distFade = smoothstep(120.0, 320.0, camDist);
    float lighting = mix(baseLighting, 0.88, distFade * 0.55);

    if (uLightsOff > 0.5) {
      float darkAmbient = 0.07 + 0.04 * hemi;
      float stageDist = length(vWorldPos.xz - uStagePos.xz);
      float stagePool = uStageGlow * exp(-(stageDist * stageDist) / (46.0 * 46.0));
      lighting = mix(darkAmbient, 0.78 + 0.16 * hemi, stagePool * 0.88);
    }

    gl_FragColor = vec4(vColor.rgb * lighting, vColor.a);
  }
`;

class Renderer3D {
  constructor(canvas, gl, width, height) {
    this.canvas = canvas;
    this.gl = gl;
    this.width = width;
    this.height = height;

    this.venue = null;
    this.viewMode = 'concert';
    this.selectedSectorId = null;
    this.selectedModuleId = null;
    this.selectedFloorBlockId = null;

    this.cameraMode = 'bird';
    this.zoomLevel = 1.0;
    this.baseFovDeg = 56;

    this.camEye = { x: 0, y: 165, z: 215 };
    this.camTarget = { x: 0, y: 0, z: 0 };
    this.targetEye = { x: 0, y: 165, z: 215 };
    this.targetLook = { x: 0, y: 0, z: 0 };

    this.orbitYaw = 0.42;
    this.orbitPitch = 0.68;
    this.orbitDist = 260;
    this.seatYawOffset = 0;
    this.seatPitchOffset = 0;

    this.projMat = Mat4.create();
    this.viewMat = Mat4.create();
    this.mvpMat = Mat4.create();

    this.solidBuffers = null;
    this.screenBuffers = null;
    this.alphaBuffers = null;
    this.beamBuffers = null;
    this.dynSolidBuffers = null;
    this.dynScreenBuffers = null;
    this.ledBuffers = null;
    this.ledTexture = null;
    this.ledTextureVenueName = null;
    this.seatInstBuffers = null;
    this.seatProtoBuffers = null;
    this.instExt = null;

    this._needsRender = true;
    this.onNeedRender = null;

    this.tierColorOverrides = {};

    this.sceneManager = new SceneManager('floating-island');

    this.startTime = Date.now();
    this.initGL();
  }

  requestRender() {
    this._needsRender = true;
    if (typeof this.onNeedRender === 'function') {
      this.onNeedRender();
    }
  }

  needsRender() {
    return Boolean(this._needsRender);
  }

  hasDynamicAnimation() {
    return Boolean(this.sceneManager && this.sceneManager.hasDynamicAnimation());
  }

  isCameraAnimating() {
    const eps = 0.03;
    return (
      Math.abs(this.targetEye.x - this.camEye.x) > eps ||
      Math.abs(this.targetEye.y - this.camEye.y) > eps ||
      Math.abs(this.targetEye.z - this.camEye.z) > eps ||
      Math.abs(this.targetLook.x - this.camTarget.x) > eps ||
      Math.abs(this.targetLook.y - this.camTarget.y) > eps ||
      Math.abs(this.targetLook.z - this.camTarget.z) > eps
    );
  }

  setScene(sceneId) {
    if (this.sceneManager) {
      const success = this.sceneManager.setCurrentScene(sceneId);
      if (success && this.venue && this.gl) {
        this.rebuildSceneMeshes();
        this.requestRender();
      }
      return success;
    }
    return false;
  }

  getScene() {
    return this.sceneManager ? this.sceneManager.getCurrentScene() : null;
  }

  getSceneId() {
    return this.sceneManager ? this.sceneManager.getCurrentSceneId() : null;
  }

  isLightsOffScene() {
    return Boolean(this.sceneManager && this.sceneManager.getCurrentSceneId() === 'lights-off');
  }

  initGL() {
    const gl = this.gl;
    if (!gl) return;
    const vs = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    this.program = prog;
    this.attribPos = gl.getAttribLocation(prog, 'aPosition');
    this.attribNorm = gl.getAttribLocation(prog, 'aNormal');
    this.attribCol = gl.getAttribLocation(prog, 'aColor');
    this.attribUv = gl.getAttribLocation(prog, 'aUv');
    this.attribInstPosWidth = gl.getAttribLocation(prog, 'aInstPosWidth');
    this.attribInstDirDepth = gl.getAttribLocation(prog, 'aInstDirDepth');
    this.attribInstPanCol = gl.getAttribLocation(prog, 'aInstPanCol');
    this.attribInstBackCol = gl.getAttribLocation(prog, 'aInstBackCol');
    this.uniMVP = gl.getUniformLocation(prog, 'uMVP');
    this.uniIsInstancedSeat = gl.getUniformLocation(prog, 'uIsInstancedSeat');
    this.uniTime = gl.getUniformLocation(prog, 'uTime');
    this.uniIsUnlit = gl.getUniformLocation(prog, 'uIsUnlit');
    this.uniUseTex = gl.getUniformLocation(prog, 'uUseTex');
    this.uniLedTex = gl.getUniformLocation(prog, 'uLedTex');
    this.uniCamEye = gl.getUniformLocation(prog, 'uCamEye');
    this.uniLightsOff = gl.getUniformLocation(prog, 'uLightsOff');
    this.uniStagePos = gl.getUniformLocation(prog, 'uStagePos');
    this.uniStageGlow = gl.getUniformLocation(prog, 'uStageGlow');

    this.instExt = typeof gl.getExtension === 'function' ? gl.getExtension('ANGLE_instanced_arrays') : null;
    if (this.instExt && typeof this.instExt.vertexAttribDivisorANGLE === 'function' && typeof this.instExt.drawArraysInstancedANGLE === 'function') {
      const proto = MeshBuilder.createSeatPrototype();
      this.seatProtoBuffers = this.uploadMesh(proto);
    } else {
      this.instExt = null;
      this.seatProtoBuffers = null;
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  }

  compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    if (this.gl) {
      this.gl.viewport(0, 0, width, height);
    }
    this.requestRender();
  }

  setVenue(venue, viewMode, selection) {
    this.venue = venue;
    if (this.sceneManager) {
      this.sceneManager.setVenue(venue);
    }
    if (viewMode) this.viewMode = viewMode;
    if (selection) {
      this.selectedSectorId = selection.sectorId || null;
      this.selectedModuleId = selection.moduleId || null;
      this.selectedFloorBlockId = selection.floorBlockId || null;
    }
    // 3D 进入页面开始渲染时，场馆总是以最小形态（最大缩放距离 460）展示
    this.orbitDist = 460;
    this.setBirdEyeView();
    this.rebuildSceneMeshes();
    this.requestRender();
  }

  setViewMode(viewMode) {
    this.viewMode = viewMode;
    this.rebuildSceneMeshes();
    this.requestRender();
  }

  setSelection(sectorId, moduleId, floorBlockId) {
    // 3D seat colors & geometry stay constant on selection — never block UI by rebuilding WebGL meshes!
    this.selectedSectorId = sectorId || null;
    this.selectedModuleId = moduleId || null;
    this.selectedFloorBlockId = floorBlockId || null;
  }

  setTierColorOverrides(overrides) {
    this.tierColorOverrides = Object.assign({}, overrides || {});
    if (this.venue && this.gl) {
      this.rebuildSceneMeshes();
      this.requestRender();
    }
  }

  setZoom(zoom) {
    this.zoomLevel = zoom;
    this.requestRender();
  }

  setBirdEyeView() {
    this.cameraMode = 'bird';
    this.seatYawOffset = 0;
    this.seatPitchOffset = 0;
    this.zoomLevel = 1.0;
    this.orbitDist = 460; // 始终以最小形态（页面无法再缩小）展示
    this.updateBirdCameraTarget();
    this.camEye = { ...this.targetEye };
    this.camTarget = { ...this.targetLook };
    this.requestRender();
  }

  updateBirdCameraTarget() {
    const r = this.orbitDist;
    const cosP = Math.cos(this.orbitPitch);
    const sinP = Math.sin(this.orbitPitch);
    this.targetEye = {
      x: Math.sin(this.orbitYaw) * cosP * r,
      y: Math.max(22, sinP * r),
      z: Math.cos(this.orbitYaw) * cosP * r
    };
    this.targetLook = { x: 0, y: 6, z: 0 };
  }

  flyToSeat(sightlineData) {
    if (!sightlineData) return;
    this.cameraMode = 'seat';
    this.seatYawOffset = 0;
    this.seatPitchOffset = 0;
    this.baseSeatEye = { ...sightlineData.eye };
    this.baseSeatTarget = { ...sightlineData.target };
    this.updateSeatCameraTarget();
    this.requestRender();
  }

  updateSeatCameraTarget() {
    if (!this.baseSeatEye || !this.baseSeatTarget) return;
    this.targetEye = {
      x: this.baseSeatEye.x,
      y: Math.max(1.2, this.baseSeatEye.y),
      z: this.baseSeatEye.z
    };

    const dx = this.baseSeatTarget.x - this.targetEye.x;
    const dy = this.baseSeatTarget.y - this.targetEye.y;
    const dz = this.baseSeatTarget.z - this.targetEye.z;
    const horizDist = Math.hypot(dx, dz) || 1;
    const baseYaw = Math.atan2(dx, dz);
    const basePitch = Math.atan2(dy, horizDist);

    const finalYaw = baseYaw + this.seatYawOffset;
    const finalPitch = Math.max(-0.58, Math.min(0.58, basePitch + this.seatPitchOffset));
    const dist = Math.hypot(dx, dy, dz) || 50;

    this.targetLook = {
      x: this.targetEye.x + Math.sin(finalYaw) * Math.cos(finalPitch) * dist,
      y: this.targetEye.y + Math.sin(finalPitch) * dist,
      z: this.targetEye.z + Math.cos(finalYaw) * Math.cos(finalPitch) * dist
    };
  }

  handleTouchDrag(dxPx, dyPx) {
    if (this.cameraMode === 'bird') {
      // Reversed 3D drag controls (both horizontal & vertical) per user preference
      this.orbitYaw += dxPx * 0.007;
      // Clamp orbitPitch strictly between 17 deg and 79 deg so camera never dips under stadium
      this.orbitPitch = Math.max(0.30, Math.min(1.38, this.orbitPitch - dyPx * 0.006));
      this.updateBirdCameraTarget();
    } else {
      const sensitivity = 0.0035 / Math.sqrt(this.zoomLevel || 1);
      this.seatYawOffset += dxPx * sensitivity;
      this.seatPitchOffset = Math.max(-0.55, Math.min(0.55, this.seatPitchOffset + dyPx * sensitivity));
      this.updateSeatCameraTarget();
    }
    this.requestRender();
  }

  handlePinchZoom(scaleDelta) {
    if (this.cameraMode === 'bird') {
      this.orbitDist = Math.max(85, Math.min(460, this.orbitDist / scaleDelta));
      this.updateBirdCameraTarget();
    } else {
      this.zoomLevel = Math.max(0.5, Math.min(5.5, this.zoomLevel * scaleDelta));
    }
    this.requestRender();
  }

  /**
   * 鸟瞰视角下按屏幕归一化坐标 (0..1) 拾取看台分区 / 内场模块 / 内场座位区块。
   * 做法：由相机参数构造拾取射线，沿线步进判断是否命中某层看台的座位斜面。
   */

  disposeBufferGroup(bufGroup) {
    if (!bufGroup || !this.gl) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    if (bufGroup.posBuf) gl.deleteBuffer(bufGroup.posBuf);
    if (bufGroup.normBuf) gl.deleteBuffer(bufGroup.normBuf);
    if (bufGroup.colBuf) gl.deleteBuffer(bufGroup.colBuf);
    if (bufGroup.uvBuf) gl.deleteBuffer(bufGroup.uvBuf);
    if (bufGroup.instBuf) gl.deleteBuffer(bufGroup.instBuf);
  }

  updateLedBannerTexture(venueName) {
    const gl = this.gl;
    if (!gl || typeof wx === 'undefined' || typeof wx.createOffscreenCanvas !== 'function') {
      return;
    }
    const label = (venueName ? String(venueName).trim() : '') || '智慧体育场馆';
    if (this.ledTexture && this.ledTextureVenueName === label) {
      return;
    }

    try {
      const texW = 1024;
      const texH = 128;
      const canvas = wx.createOffscreenCanvas({ type: '2d', width: texW, height: texH });
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Illuminated deep-electric-blue LED panel backdrop
      const grad = ctx.createLinearGradient(0, 0, texW, 0);
      grad.addColorStop(0.0, '#071a3e');
      grad.addColorStop(0.25, '#0d367a');
      grad.addColorStop(0.5, '#13499e');
      grad.addColorStop(0.75, '#0d367a');
      grad.addColorStop(1.0, '#071a3e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, texW, texH);

      // Top and bottom glowing cyan/gold LED ticker borders
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(0, 0, texW, 6);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(0, texH - 6, texW, 6);

      // Subtle vertical LED module divider accent
      ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.fillRect(0, 14, 6, texH - 28);
      ctx.fillRect(texW - 6, 14, 6, texH - 28);

      const text = `${label}欢迎你`;
      let fontSize = 56;
      ctx.font = `bold ${fontSize}px sans-serif`;
      const maxTextW = texW - 88;
      let measured = ctx.measureText(text).width;
      if (measured > maxTextW && measured > 0) {
        fontSize = Math.max(26, Math.floor(fontSize * (maxTextW / measured)));
        ctx.font = `bold ${fontSize}px sans-serif`;
      }

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(56, 189, 248, 0.9)';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, texW * 0.5, texH * 0.52);

      // Second pass crisp golden-white highlight
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#fef08a';
      ctx.fillText(text, texW * 0.5, texH * 0.52);

      const imgData = ctx.getImageData(0, 0, texW, texH);
      const pixels = new Uint8Array(imgData.data.buffer, imgData.data.byteOffset, imgData.data.byteLength);

      if (this.ledTexture && typeof gl.deleteTexture === 'function') {
        gl.deleteTexture(this.ledTexture);
      }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texW, texH, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindTexture(gl.TEXTURE_2D, null);

      this.ledTexture = tex;
      this.ledTextureVenueName = label;
    } catch (e) {
      // Safe fallback when offscreen canvas or getImageData is unavailable
    }
  }

  rebuildSceneMeshes() {
    if (!this.venue || !this.gl) return;

    this.disposeBufferGroup(this.solidBuffers);
    this.disposeBufferGroup(this.screenBuffers);
    this.disposeBufferGroup(this.alphaBuffers);
    this.disposeBufferGroup(this.beamBuffers);
    this.disposeBufferGroup(this.dynSolidBuffers);
    this.disposeBufferGroup(this.dynScreenBuffers);
    this.disposeBufferGroup(this.ledBuffers);
    this.disposeBufferGroup(this.seatInstBuffers);
    this.solidBuffers = null;
    this.screenBuffers = null;
    this.alphaBuffers = null;
    this.beamBuffers = null;
    this.dynSolidBuffers = null;
    this.dynScreenBuffers = null;
    this.ledBuffers = null;
    this.seatInstBuffers = null;

    let estRows = 0;
    const tiers = (this.venue && this.venue.standTiers) || [];
    for (let ti = 0; ti < tiers.length; ti++) {
      const t = tiers[ti];
      const secs = t.sectors || [];
      for (let si = 0; si < secs.length; si++) {
        const s = secs[si];
        if (!s.isDeleted && s.fillType !== 'empty-void') {
          estRows += (s.rows || t.defaultRows || 22);
        }
      }
    }
    const useInstancing = Boolean(this.instExt && this.seatProtoBuffers);
    const estSolidCap = useInstancing
      ? Math.max(32768, Math.min(524288, estRows * 260))
      : Math.max(65536, Math.min(4194304, estRows * 3000));
    const solid = new MeshBuilder(estSolidCap);
    if (useInstancing) {
      solid.enableSeatInstancing(Math.max(8192, estRows * 35));
    }
    const screens = new MeshBuilder(4096);
    const alpha = new MeshBuilder(4096);
    const beams = new MeshBuilder(1024);
    const dynSolid = new MeshBuilder(2048);
    const dynScreens = new MeshBuilder(512);

    // 1. Exterior Scene (e.g. Floating Island) & Stadium Perimeter Cladding
    if (this.sceneManager && this.sceneManager.getCurrentSceneId() !== 'default') {
      this.sceneManager.buildMeshes({ solid, screens, alpha, beams, dynSolid, dynScreens }, { overrides: this.tierColorOverrides });
      if (typeof this.buildExteriorFacadeShell === 'function') {
        this.buildExteriorFacadeShell(solid, alpha);
      } else {
        this.buildGroundAndShell(solid, alpha);
      }
    } else {
      this.buildGroundAndShell(solid, alpha);
    }

    // 2. Infield Floor, Running Track / Court / Grass Pitch
    this.buildInfieldMesh(solid);

    // 3. Schema Infield Modules (sports sideline seating only — prevents clash with rotated concert stage)
    if (this.viewMode === 'sports') {
      this.buildInfieldModulesMesh(solid, alpha);
    }

    // 4. Stand Tiers: Stepped concrete rows, row-by-row 3D seats, radial stairs + handrails,
    //    carved vomitory tunnels, architectural VIP luxury suites, front guardrails
    this.buildStandTiersMesh(solid, alpha, screens);

    // 5. Architectural Thick Roof Canopy Ring (zero Z-fighting!)
    this.buildStadiumCanopyRim(solid, alpha, screens);

    // 6. Concert Stage + Concert Infield Floor Seating Blocks OR Sports Goals/Hoops & Perimeter LED Boards
    let ledBoards = null;
    if (this.viewMode === 'concert') {
      this.buildConcertInfieldSeatsMesh(solid, alpha);
      this.buildConcertStageMesh(solid, screens, beams);
    } else {
      ledBoards = new MeshBuilder(256);
      const venueName = (this.venue && (this.venue.name || this.venue.shortLabel)) || '体育场馆';
      this.updateLedBannerTexture(venueName);
      this.buildSportsEquipmentMesh(solid, alpha, screens, this.ledTexture ? ledBoards : null);
    }

    this.solidBuffers = this.uploadMesh(solid);
    this.screenBuffers = this.uploadMesh(screens);
    this.alphaBuffers = this.uploadMesh(alpha);
    this.beamBuffers = this.uploadMesh(beams);
    this.dynSolidBuffers = this.uploadMesh(dynSolid, this.gl.DYNAMIC_DRAW);
    this.dynScreenBuffers = this.uploadMesh(dynScreens, this.gl.DYNAMIC_DRAW);
    if (ledBoards) {
      this.ledBuffers = this.uploadMesh(ledBoards);
    }
    if (useInstancing && solid.seatInstanceCount > 0) {
      this.seatInstBuffers = this.uploadSeatInstances(solid.seatInstances, solid.seatInstanceCount);
    }
  }



  uploadMesh(meshBuilder, usage) {
    const gl = this.gl;
    const pos = meshBuilder.positions;
    const count = pos.length / 3;
    if (count === 0) return { count: 0 };
    const drawUsage = usage || gl.STATIC_DRAW;

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos instanceof Float32Array ? pos : new Float32Array(pos), drawUsage);

    const norm = meshBuilder.normals;
    const normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, norm instanceof Float32Array ? norm : new Float32Array(norm), drawUsage);

    const col = meshBuilder.colors;
    const colBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, col instanceof Float32Array ? col : new Float32Array(col), drawUsage);

    let uvBuf = null;
    const uvs = meshBuilder.uvs;
    if (uvs && uvs.length > 0) {
      uvBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, uvs instanceof Float32Array ? uvs : new Float32Array(uvs), drawUsage);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return { posBuf, normBuf, colBuf, uvBuf, count };
  }

  uploadSeatInstances(instData, instCount) {
    if (!instData || instCount === 0) return { count: 0 };
    const gl = this.gl;
    const instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, instData, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return { instBuf, count: instCount };
  }

  drawInstancedSeats() {
    if (!this.instExt || !this.seatProtoBuffers || !this.seatInstBuffers || this.seatInstBuffers.count === 0) {
      return;
    }
    const gl = this.gl;
    const proto = this.seatProtoBuffers;
    const inst = this.seatInstBuffers;

    if (this.uniIsInstancedSeat) gl.uniform1f(this.uniIsInstancedSeat, 1.0);
    gl.uniform1f(this.uniIsUnlit, 0.0);

    gl.bindBuffer(gl.ARRAY_BUFFER, proto.posBuf);
    gl.enableVertexAttribArray(this.attribPos);
    gl.vertexAttribPointer(this.attribPos, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, proto.normBuf);
    gl.enableVertexAttribArray(this.attribNorm);
    gl.vertexAttribPointer(this.attribNorm, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, proto.colBuf);
    gl.enableVertexAttribArray(this.attribCol);
    gl.vertexAttribPointer(this.attribCol, 4, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, inst.instBuf);
    const stride = 52;
    if (this.attribInstPosWidth >= 0) {
      gl.enableVertexAttribArray(this.attribInstPosWidth);
      gl.vertexAttribPointer(this.attribInstPosWidth, 4, gl.FLOAT, false, stride, 0);
      this.instExt.vertexAttribDivisorANGLE(this.attribInstPosWidth, 1);
    }
    if (this.attribInstDirDepth >= 0) {
      gl.enableVertexAttribArray(this.attribInstDirDepth);
      gl.vertexAttribPointer(this.attribInstDirDepth, 3, gl.FLOAT, false, stride, 16);
      this.instExt.vertexAttribDivisorANGLE(this.attribInstDirDepth, 1);
    }
    if (this.attribInstPanCol >= 0) {
      gl.enableVertexAttribArray(this.attribInstPanCol);
      gl.vertexAttribPointer(this.attribInstPanCol, 3, gl.FLOAT, false, stride, 28);
      this.instExt.vertexAttribDivisorANGLE(this.attribInstPanCol, 1);
    }
    if (this.attribInstBackCol >= 0) {
      gl.enableVertexAttribArray(this.attribInstBackCol);
      gl.vertexAttribPointer(this.attribInstBackCol, 3, gl.FLOAT, false, stride, 40);
      this.instExt.vertexAttribDivisorANGLE(this.attribInstBackCol, 1);
    }

    this.instExt.drawArraysInstancedANGLE(gl.TRIANGLES, 0, proto.count, inst.count);

    if (this.attribInstPosWidth >= 0) {
      this.instExt.vertexAttribDivisorANGLE(this.attribInstPosWidth, 0);
      gl.disableVertexAttribArray(this.attribInstPosWidth);
    }
    if (this.attribInstDirDepth >= 0) {
      this.instExt.vertexAttribDivisorANGLE(this.attribInstDirDepth, 0);
      gl.disableVertexAttribArray(this.attribInstDirDepth);
    }
    if (this.attribInstPanCol >= 0) {
      this.instExt.vertexAttribDivisorANGLE(this.attribInstPanCol, 0);
      gl.disableVertexAttribArray(this.attribInstPanCol);
    }
    if (this.attribInstBackCol >= 0) {
      this.instExt.vertexAttribDivisorANGLE(this.attribInstBackCol, 0);
      gl.disableVertexAttribArray(this.attribInstBackCol);
    }
    if (this.uniIsInstancedSeat) gl.uniform1f(this.uniIsInstancedSeat, 0.0);
  }

  drawBufferGroup(bufGroup, isUnlit) {
    if (!bufGroup || bufGroup.count === 0) return;
    const gl = this.gl;

    if (this.uniIsInstancedSeat) gl.uniform1f(this.uniIsInstancedSeat, 0.0);
    if (this.uniUseTex) gl.uniform1f(this.uniUseTex, 0.0);
    gl.uniform1f(this.uniIsUnlit, isUnlit ? 1.0 : 0.0);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufGroup.posBuf);
    gl.enableVertexAttribArray(this.attribPos);
    gl.vertexAttribPointer(this.attribPos, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufGroup.normBuf);
    gl.enableVertexAttribArray(this.attribNorm);
    gl.vertexAttribPointer(this.attribNorm, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufGroup.colBuf);
    gl.enableVertexAttribArray(this.attribCol);
    gl.vertexAttribPointer(this.attribCol, 4, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, bufGroup.count);
  }

  drawTexturedBufferGroup(bufGroup, texture) {
    if (!bufGroup || bufGroup.count === 0 || !bufGroup.uvBuf || !texture) return;
    const gl = this.gl;

    if (this.uniIsInstancedSeat) gl.uniform1f(this.uniIsInstancedSeat, 0.0);
    gl.uniform1f(this.uniIsUnlit, 1.0);
    if (this.uniUseTex) gl.uniform1f(this.uniUseTex, 1.0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (this.uniLedTex) gl.uniform1i(this.uniLedTex, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufGroup.posBuf);
    gl.enableVertexAttribArray(this.attribPos);
    gl.vertexAttribPointer(this.attribPos, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufGroup.normBuf);
    gl.enableVertexAttribArray(this.attribNorm);
    gl.vertexAttribPointer(this.attribNorm, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufGroup.colBuf);
    gl.enableVertexAttribArray(this.attribCol);
    gl.vertexAttribPointer(this.attribCol, 4, gl.FLOAT, false, 0, 0);

    if (this.attribUv >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, bufGroup.uvBuf);
      gl.enableVertexAttribArray(this.attribUv);
      gl.vertexAttribPointer(this.attribUv, 2, gl.FLOAT, false, 0, 0);
    }

    gl.drawArrays(gl.TRIANGLES, 0, bufGroup.count);

    if (this.attribUv >= 0) {
      gl.disableVertexAttribArray(this.attribUv);
    }
    if (this.uniUseTex) gl.uniform1f(this.uniUseTex, 0.0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  renderFrame() {
    const gl = this.gl;
    if (!gl || !this.program) return;
    this._needsRender = false;

    const lerp = 0.14;
    this.camEye.x += (this.targetEye.x - this.camEye.x) * lerp;
    this.camEye.y += (this.targetEye.y - this.camEye.y) * lerp;
    this.camEye.z += (this.targetEye.z - this.camEye.z) * lerp;

    // Hard floor guard so camera NEVER dips underneath the stadium during transitions
    const minEyeY = this.cameraMode === 'bird' ? 14.0 : 1.1;
    if (this.camEye.y < minEyeY) this.camEye.y = minEyeY;

    this.camTarget.x += (this.targetLook.x - this.camTarget.x) * lerp;
    this.camTarget.y += (this.targetLook.y - this.camTarget.y) * lerp;
    this.camTarget.z += (this.targetLook.z - this.camTarget.z) * lerp;

    const aspect = (this.width || 375) / Math.max(1, this.height || 400);
    let fovRad = (this.baseFovDeg / Math.pow(this.zoomLevel || 1, 0.85)) * DEG2RAD;
    if (this.cameraMode === 'bird' && aspect < 1.0) {
      // Compensate horizontal FOV so bird's eye view platform never clips in portrait mode
      fovRad = 2 * Math.atan(Math.tan(fovRad / 2) / aspect);
    }
    const effectiveFovRad = Math.max(12 * DEG2RAD, Math.min(105 * DEG2RAD, fovRad));

    const nearPlane = this.cameraMode === 'bird' ? 2.5 : 0.8;
    Mat4.perspective(this.projMat, effectiveFovRad, aspect, nearPlane, 950.0);
    Mat4.lookAt(this.viewMat, this.camEye, this.camTarget, { x: 0, y: 1, z: 0 });
    Mat4.multiply(this.mvpMat, this.projMat, this.viewMat);

    gl.viewport(0, 0, this.width, this.height);
    const overrides = this.tierColorOverrides || {};
    let clearR = 10 / 255, clearG = 15 / 255, clearB = 29 / 255;
    const sceneClear = this.sceneManager ? this.sceneManager.getClearColor() : null;
    const isCustomScene = this.sceneManager && this.sceneManager.getCurrentSceneId() !== 'default';
    if (isCustomScene && sceneClear) {
      clearR = sceneClear[0];
      clearG = sceneClear[1];
      clearB = sceneClear[2];
    } else if (overrides.sky) {
      const skyRgb = parseHexRgb(overrides.sky) || { r: 10, g: 15, b: 29 };
      clearR = skyRgb.r / 255;
      clearG = skyRgb.g / 255;
      clearB = skyRgb.b / 255;
    } else if (sceneClear) {
      clearR = sceneClear[0];
      clearG = sceneClear[1];
      clearB = sceneClear[2];
    }
    gl.clearColor(clearR, clearG, clearB, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniMVP, false, this.mvpMat);
    const elapsedSec = (Date.now() - this.startTime) * 0.001;
    gl.uniform1f(this.uniTime, elapsedSec);
    if (this.uniCamEye) {
      gl.uniform3f(this.uniCamEye, this.camEye.x, this.camEye.y, this.camEye.z);
    }
    const isLightsOff = this.isLightsOffScene();
    if (this.uniLightsOff) {
      gl.uniform1f(this.uniLightsOff, isLightsOff ? 1.0 : 0.0);
    }
    if (this.uniStagePos && this.uniStageGlow) {
      const hasStage = isLightsOff && this.viewMode === 'concert' && this.venue && this.venue.infield && this.venue.infield.stageConfig;
      if (hasStage) {
        const st = getStageTransform(this.venue);
        const stageWorld = rotateXZ(st.stageLocalX || 0, st.stageLocalZ || 0, st.rotFromSouthDeg || 0);
        gl.uniform3f(this.uniStagePos, stageWorld.x, 0.0, stageWorld.z);
        gl.uniform1f(this.uniStageGlow, 1.0);
      } else {
        gl.uniform3f(this.uniStagePos, 0.0, 0.0, 0.0);
        gl.uniform1f(this.uniStageGlow, 0.0);
      }
    }

    // Update dynamic exterior scene animations (e.g. clouds, fairy sparkles)
    if (this.sceneManager) {
      this.sceneManager.update(elapsedSec, 0.016, gl, {
        solidBuffers: this.solidBuffers,
        screenBuffers: this.screenBuffers,
        dynSolidBuffers: this.dynSolidBuffers,
        dynScreenBuffers: this.dynScreenBuffers
      });
    }

    // 1. Opaque stadium, instanced seats, dynamic clouds, vomitories, trusses & stage
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    this.drawBufferGroup(this.solidBuffers, false);
    this.drawInstancedSeats();
    this.drawBufferGroup(this.dynSolidBuffers, false);

    // 1b. Self-luminous elements (VIP suite warm cove lighting + LED screens + dynamic sparkles)
    if (this.screenBuffers && this.screenBuffers.count > 0) {
      this.drawBufferGroup(this.screenBuffers, true);
    }
    if (this.dynScreenBuffers && this.dynScreenBuffers.count > 0) {
      this.drawBufferGroup(this.dynScreenBuffers, true);
    }
    if (this.ledBuffers && this.ledBuffers.count > 0 && this.ledTexture) {
      this.drawTexturedBufferGroup(this.ledBuffers, this.ledTexture);
    }

    // 2. Tempered glass guardrails
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    this.drawBufferGroup(this.alphaBuffers, false);

    // 3. Soft concert stage spotlight beams
    if (this.viewMode === 'concert') {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      this.drawBufferGroup(this.beamBuffers, true);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}

// Attach all modular mixins to Renderer3D prototype
Object.assign(
  Renderer3D.prototype,
  AngleMixin,
  CanopyMixin,
  StageMixin,
  InfieldMixin,
  StandMixin,
  RaycastMixin
);

Renderer3D.Mat4 = Mat4;
Renderer3D.MeshBuilder = MeshBuilder;
Renderer3D.SceneManager = SceneManager;

module.exports = {
  Renderer3D,
  Mat4,
  MeshBuilder,
  SceneManager
};
