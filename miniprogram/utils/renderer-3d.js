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
  uniform mat4 uMVP;
  varying vec3 vNormal;
  varying vec4 vColor;
  varying vec3 vWorldPos;

  void main() {
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
  uniform float uTime;
  uniform float uIsUnlit;

  void main() {
    if (uIsUnlit > 0.5) {
      gl_FragColor = vColor;
      return;
    }
    vec3 norm = normalize(vNormal);
    // Pure matte non-reflective shading: soft hemisphere + gentle wrapped diffuse, zero specular glare
    float hemi = 0.5 + 0.5 * norm.y;
    float wrap = max(0.0, (dot(norm, normalize(vec3(0.24, 0.94, 0.24))) + 0.65) / 1.65);
    float lighting = 0.68 + 0.18 * hemi + 0.12 * wrap;

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

    this.tierColorOverrides = {};

    this.sceneManager = new SceneManager('floating-island');

    this.startTime = Date.now();
    this.initGL();
  }

  setScene(sceneId) {
    if (this.sceneManager) {
      const success = this.sceneManager.setCurrentScene(sceneId);
      if (success && this.venue && this.gl) {
        this.rebuildSceneMeshes();
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
    this.uniMVP = gl.getUniformLocation(prog, 'uMVP');
    this.uniTime = gl.getUniformLocation(prog, 'uTime');
    this.uniIsUnlit = gl.getUniformLocation(prog, 'uIsUnlit');

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
  }

  setViewMode(viewMode) {
    this.viewMode = viewMode;
    this.rebuildSceneMeshes();
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
    }
  }

  setZoom(zoom) {
    this.zoomLevel = zoom;
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
  }

  handlePinchZoom(scaleDelta) {
    if (this.cameraMode === 'bird') {
      this.orbitDist = Math.max(85, Math.min(460, this.orbitDist / scaleDelta));
      this.updateBirdCameraTarget();
    } else {
      this.zoomLevel = Math.max(0.5, Math.min(5.5, this.zoomLevel * scaleDelta));
    }
  }

  /**
   * 鸟瞰视角下按屏幕归一化坐标 (0..1) 拾取看台分区 / 内场模块 / 内场座位区块。
   * 做法：由相机参数构造拾取射线，沿线步进判断是否命中某层看台的座位斜面。
   */

  disposeBufferGroup(bufGroup) {
    if (!bufGroup || !this.gl) return;
    const gl = this.gl;
    if (bufGroup.posBuf) gl.deleteBuffer(bufGroup.posBuf);
    if (bufGroup.normBuf) gl.deleteBuffer(bufGroup.normBuf);
    if (bufGroup.colBuf) gl.deleteBuffer(bufGroup.colBuf);
  }

  rebuildSceneMeshes() {
    if (!this.venue || !this.gl) return;

    this.disposeBufferGroup(this.solidBuffers);
    this.disposeBufferGroup(this.screenBuffers);
    this.disposeBufferGroup(this.alphaBuffers);
    this.disposeBufferGroup(this.beamBuffers);

    const solid = new MeshBuilder();
    const screens = new MeshBuilder();
    const alpha = new MeshBuilder();
    const beams = new MeshBuilder();

    // 1. Exterior Scene (e.g. Floating Island) & Stadium Perimeter Cladding
    if (this.sceneManager && this.sceneManager.getCurrentSceneId() !== 'default') {
      this.sceneManager.buildMeshes({ solid, screens, alpha, beams }, { overrides: this.tierColorOverrides });
      if (typeof this.buildExteriorFacadeShell === 'function') {
        this.buildExteriorFacadeShell(solid);
      } else {
        this.buildGroundAndShell(solid);
      }
    } else {
      this.buildGroundAndShell(solid);
    }

    // 2. Infield Floor, Running Track / Court / Grass Pitch
    this.buildInfieldMesh(solid);

    // 3. Schema Infield Modules (sports sideline seating only — prevents clash with rotated concert stage)
    if (this.viewMode === 'sports') {
      this.buildInfieldModulesMesh(solid);
    }

    // 4. Stand Tiers: Stepped concrete rows, row-by-row 3D seats, radial stairs + handrails,
    //    carved vomitory tunnels, architectural VIP luxury suites, front guardrails
    this.buildStandTiersMesh(solid, alpha, screens);

    // 5. Architectural Thick Roof Canopy Ring (zero Z-fighting!)
    this.buildStadiumCanopyRim(solid);

    // 6. Concert Stage + Concert Infield Floor Seating Blocks OR Sports Goals/Hoops
    if (this.viewMode === 'concert') {
      this.buildConcertInfieldSeatsMesh(solid);
      this.buildConcertStageMesh(solid, screens, beams);
    } else {
      this.buildSportsEquipmentMesh(solid);
    }

    this.solidBuffers = this.uploadMesh(solid);
    this.screenBuffers = this.uploadMesh(screens);
    this.alphaBuffers = this.uploadMesh(alpha);
    this.beamBuffers = this.uploadMesh(beams);
  }



  uploadMesh(meshBuilder) {
    const gl = this.gl;
    const count = meshBuilder.positions.length / 3;
    if (count === 0) return { count: 0 };

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(meshBuilder.positions), gl.STATIC_DRAW);

    const normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(meshBuilder.normals), gl.STATIC_DRAW);

    const colBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(meshBuilder.colors), gl.STATIC_DRAW);

    return { posBuf, normBuf, colBuf, count };
  }

  drawBufferGroup(bufGroup, isUnlit) {
    if (!bufGroup || bufGroup.count === 0) return;
    const gl = this.gl;

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

  renderFrame() {
    const gl = this.gl;
    if (!gl || !this.program) return;

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
    if (overrides.sky) {
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

    // Update dynamic exterior scene animations (e.g. clouds, fairy sparkles)
    if (this.sceneManager) {
      this.sceneManager.update(elapsedSec, 0.016, gl);
    }

    // 1. Opaque stadium, seats, vomitories, trusses & stage
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    this.drawBufferGroup(this.solidBuffers, false);

    // 1b. Self-luminous elements (VIP suite warm cove lighting + 100%-lit aurora concert LED screens)
    if (this.screenBuffers && this.screenBuffers.count > 0) {
      this.drawBufferGroup(this.screenBuffers, true);
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
