import { useState, useMemo, useRef, useEffect, Suspense } from 'react';
import { Canvas, useFrame, extend } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Float,
  Stars,
  Sparkles,
  useTexture
} from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MathUtils } from 'three';
import * as random from 'maath/random';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

// --- 动态生成照片列表 (top.jpg + 1.jpg 到 31.jpg) ---
const TOTAL_NUMBERED_PHOTOS = 31;
// 修改：将 top.jpg 加入到数组开头
const bodyPhotoPaths = [
  '/photos/top.jpg',
  ...Array.from({ length: TOTAL_NUMBERED_PHOTOS }, (_, i) => `/photos/${i + 1}.jpg`)
];

// --- 视觉配置 ---
const CONFIG = {
  colors: {
    emerald: '#004225', // 纯正祖母绿
    gold: '#FFD700',
    silver: '#ECEFF1',
    red: '#D32F2F',
    green: '#2E7D32',
    white: '#FFFFFF',   // 纯白色
    warmLight: '#FFD54F',
    lights: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'], // 彩灯
    // 拍立得边框颜色池 (复古柔和色系)
    borders: ['#FFFAF0', '#F0E68C', '#E6E6FA', '#FFB6C1', '#98FB98', '#87CEFA', '#FFDAB9'],
    // 圣诞元素颜色
    giftColors: ['#D32F2F', '#FFD700', '#1976D2', '#2E7D32'],
    candyColors: ['#FF0000', '#FFFFFF']
  },
  counts: {
    foliage: 15000,
    ornaments: 300,   // 拍立得照片数量
    elements: 200,    // 圣诞元素数量
    lights: 400       // 彩灯数量
  },
  tree: { height: 22, radius: 9 }, // 树体尺寸
  photos: {
    // top 属性不再需要，因为已经移入 body
    body: bodyPhotoPaths
  }
};

// --- Shader Material (Foliage) ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(CONFIG.colors.emerald), uProgress: 0 },
  `uniform float uTime; uniform float uProgress; attribute vec3 aTargetPos; attribute float aRandom;
  varying vec2 vUv; varying float vMix;
  float cubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0; }
  void main() {
    vUv = uv;
    vec3 noise = vec3(sin(uTime * 1.5 + position.x), cos(uTime + position.y), sin(uTime * 1.5 + position.z)) * 0.15;
    float t = cubicInOut(uProgress);
    vec3 finalPos = mix(position, aTargetPos + noise, t);
    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    gl_PointSize = (60.0 * (1.0 + aRandom)) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    vMix = t;
  }`,
  `uniform vec3 uColor; varying float vMix;
  void main() {
    float r = distance(gl_PointCoord, vec2(0.5)); if (r > 0.5) discard;
    vec3 finalColor = mix(uColor * 0.3, uColor * 1.2, vMix);
    gl_FragColor = vec4(finalColor, 1.0);
  }`
);
extend({ FoliageMaterial });

// --- Helper: Tree Shape ---
const getTreePosition = () => {
  const h = CONFIG.tree.height; const rBase = CONFIG.tree.radius;
  const y = (Math.random() * h) - (h / 2); const normalizedY = (y + (h/2)) / h;
  const currentRadius = rBase * (1 - normalizedY); const theta = Math.random() * Math.PI * 2;
  const r = Math.random() * currentRadius;
  return [r * Math.cos(theta), y, r * Math.sin(theta)];
};

// --- Component: Foliage ---
const Foliage = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const materialRef = useRef<any>(null);
  const { positions, targetPositions, randoms } = useMemo(() => {
    const count = CONFIG.counts.foliage;
    const positions = new Float32Array(count * 3); const targetPositions = new Float32Array(count * 3); const randoms = new Float32Array(count);
    const spherePoints = random.inSphere(new Float32Array(count * 3), { radius: 25 }) as Float32Array;
    for (let i = 0; i < count; i++) {
      positions[i*3] = spherePoints[i*3]; positions[i*3+1] = spherePoints[i*3+1]; positions[i*3+2] = spherePoints[i*3+2];
      const [tx, ty, tz] = getTreePosition();
      targetPositions[i*3] = tx; targetPositions[i*3+1] = ty; targetPositions[i*3+2] = tz;
      randoms[i] = Math.random();
    }
    return { positions, targetPositions, randoms };
  }, []);
  useFrame((rootState, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = rootState.clock.elapsedTime;
      const targetProgress = state === 'FORMED' ? 1 : 0;
      materialRef.current.uProgress = MathUtils.damp(materialRef.current.uProgress, targetProgress, 1.5, delta);
    }
  });
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aTargetPos" args={[targetPositions, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <foliageMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

// --- Component: Photo Ornaments (Double-Sided Polaroid) ---
const PhotoOrnaments = ({ state, photos }: { state: 'CHAOS' | 'FORMED', photos: string[] }) => {
  const textures = useTexture(photos);
  const count = CONFIG.counts.ornaments;
  const groupRef = useRef<THREE.Group>(null);

  const borderGeometry = useMemo(() => new THREE.PlaneGeometry(1.2, 1.5), []);
  const photoGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*70, (Math.random()-0.5)*70, (Math.random()-0.5)*70);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) + 0.5;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));

      const isBig = Math.random() < 0.2;
      const baseScale = isBig ? 2.2 : 0.8 + Math.random() * 0.6;
      const weight = 0.8 + Math.random() * 1.2;
      const borderColor = CONFIG.colors.borders[Math.floor(Math.random() * CONFIG.colors.borders.length)];

      const rotationSpeed = {
        x: (Math.random() - 0.5) * 1.0,
        y: (Math.random() - 0.5) * 1.0,
        z: (Math.random() - 0.5) * 1.0
      };
      const chaosRotation = new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);

      return {
        chaosPos, targetPos, scale: baseScale, weight,
        textureIndex: i % textures.length,
        borderColor,
        currentPos: chaosPos.clone(),
        chaosRotation,
        rotationSpeed,
        wobbleOffset: Math.random() * 10,
        wobbleSpeed: 0.5 + Math.random() * 0.5
      };
    });
  }, [textures, count]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;

    groupRef.current.children.forEach((group, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;

      objData.currentPos.lerp(target, delta * (isFormed ? 0.8 * objData.weight : 0.5));
      group.position.copy(objData.currentPos);

      if (isFormed) {
         const targetLookPos = new THREE.Vector3(group.position.x * 2, group.position.y + 0.5, group.position.z * 2);
         group.lookAt(targetLookPos);

         const wobbleX = Math.sin(time * objData.wobbleSpeed + objData.wobbleOffset) * 0.05;
         const wobbleZ = Math.cos(time * objData.wobbleSpeed * 0.8 + objData.wobbleOffset) * 0.05;
         group.rotation.x += wobbleX;
         group.rotation.z += wobbleZ;

      } else {
         group.rotation.x += delta * objData.rotationSpeed.x;
         group.rotation.y += delta * objData.rotationSpeed.y;
         group.rotation.z += delta * objData.rotationSpeed.z;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (
        <group key={i} scale={[obj.scale, obj.scale, obj.scale]} rotation={state === 'CHAOS' ? obj.chaosRotation : [0,0,0]}>
          {/* 正面 */}
          <group position={[0, 0, 0.015]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial
                map={textures[obj.textureIndex]}
                roughness={0.5} metalness={0}
                emissive={CONFIG.colors.white} emissiveMap={textures[obj.textureIndex]} emissiveIntensity={1.0}
                side={THREE.FrontSide}
              />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial color={obj.borderColor} roughness={0.9} metalness={0} side={THREE.FrontSide} />
            </mesh>
          </group>
          {/* 背面 */}
          <group position={[0, 0, -0.015]} rotation={[0, Math.PI, 0]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial
                map={textures[obj.textureIndex]}
                roughness={0.5} metalness={0}
                emissive={CONFIG.colors.white} emissiveMap={textures[obj.textureIndex]} emissiveIntensity={1.0}
                side={THREE.FrontSide}
              />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial color={obj.borderColor} roughness={0.9} metalness={0} side={THREE.FrontSide} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
};

// --- Component: Christmas Elements ---
const ChristmasElements = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.elements;
  const groupRef = useRef<THREE.Group>(null);

  const boxGeometry = useMemo(() => new THREE.BoxGeometry(0.8, 0.8, 0.8), []);
  const sphereGeometry = useMemo(() => new THREE.SphereGeometry(0.5, 16, 16), []);
  const caneGeometry = useMemo(() => new THREE.CylinderGeometry(0.15, 0.15, 1.2, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height;
      const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) * 0.95;
      const theta = Math.random() * Math.PI * 2;

      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));

      const type = Math.floor(Math.random() * 3);
      let color; let scale = 1;
      if (type === 0) { color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; scale = 0.8 + Math.random() * 0.4; }
      else if (type === 1) { color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; scale = 0.6 + Math.random() * 0.4; }
      else { color = Math.random() > 0.5 ? CONFIG.colors.red : CONFIG.colors.white; scale = 0.7 + Math.random() * 0.3; }

      const rotationSpeed = { x: (Math.random()-0.5)*2.0, y: (Math.random()-0.5)*2.0, z: (Math.random()-0.5)*2.0 };
      return { type, chaosPos, targetPos, color, scale, currentPos: chaosPos.clone(), chaosRotation: new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI), rotationSpeed };
    });
  }, [boxGeometry, sphereGeometry, caneGeometry]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    groupRef.current.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh;
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 1.5);
      mesh.position.copy(objData.currentPos);
      mesh.rotation.x += delta * objData.rotationSpeed.x; mesh.rotation.y += delta * objData.rotationSpeed.y; mesh.rotation.z += delta * objData.rotationSpeed.z;
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => {
        let geometry; if (obj.type === 0) geometry = boxGeometry; else if (obj.type === 1) geometry = sphereGeometry; else geometry = caneGeometry;
        return ( <mesh key={i} scale={[obj.scale, obj.scale, obj.scale]} geometry={geometry} rotation={obj.chaosRotation}>
          <meshStandardMaterial color={obj.color} roughness={0.3} metalness={0.4} emissive={obj.color} emissiveIntensity={0.2} />
        </mesh> )})}
    </group>
  );
};

// --- Component: Fairy Lights ---
const FairyLights = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const count = CONFIG.counts.lights;
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.8, 8, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2); const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) + 0.3; const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const color = CONFIG.colors.lights[Math.floor(Math.random() * CONFIG.colors.lights.length)];
      const speed = 2 + Math.random() * 3;
      return { chaosPos, targetPos, color, speed, currentPos: chaosPos.clone(), timeOffset: Math.random() * 100 };
    });
  }, []);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 2.0);
      const mesh = child as THREE.Mesh;
      mesh.position.copy(objData.currentPos);
      const intensity = (Math.sin(time * objData.speed + objData.timeOffset) + 1) / 2;
      if (mesh.material) { (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = isFormed ? 3 + intensity * 4 : 0; }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => ( <mesh key={i} scale={[0.15, 0.15, 0.15]} geometry={geometry}>
          <meshStandardMaterial color={obj.color} emissive={obj.color} emissiveIntensity={0} toneMapped={false} />
        </mesh> ))}
    </group>
  );
};

// --- Component: Top Star (No Photo, Pure Gold 3D Star) ---
const TopStar = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const groupRef = useRef<THREE.Group>(null);

  const starShape = useMemo(() => {
    const shape = new THREE.Shape();
    const outerRadius = 1.3; const innerRadius = 0.7; const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      i === 0 ? shape.moveTo(radius*Math.cos(angle), radius*Math.sin(angle)) : shape.lineTo(radius*Math.cos(angle), radius*Math.sin(angle));
    }
    shape.closePath();
    return shape;
  }, []);

  const starGeometry = useMemo(() => {
    return new THREE.ExtrudeGeometry(starShape, {
      depth: 0.4, // 增加一点厚度
      bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 3,
    });
  }, [starShape]);

  // 纯金材质
  const goldMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: CONFIG.colors.gold,
    emissive: CONFIG.colors.gold,
    emissiveIntensity: 1.5, // 适中亮度，既发光又有质感
    roughness: 0.1,
    metalness: 1.0,
  }), []);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.5;
      const targetScale = state === 'FORMED' ? 1 : 0;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 3);
    }
  });

  return (
    <group ref={groupRef} position={[0, CONFIG.tree.height / 2 + 1.8, 0]}>
      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.2}>
        <mesh geometry={starGeometry} material={goldMaterial} />
      </Float>
    </group>
  );
};

// --- Main Scene Experience ---
const Experience = ({ sceneState, rotationSpeed, photos }: { sceneState: 'CHAOS' | 'FORMED', rotationSpeed: number, photos: string[] }) => {
  const controlsRef = useRef<any>(null);
  useFrame(() => {
    if (controlsRef.current) {
      controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + rotationSpeed);
      controlsRef.current.update();
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 8, 60]} fov={45} />
      <OrbitControls ref={controlsRef} enablePan={false} enableZoom={true} minDistance={30} maxDistance={120} autoRotate={rotationSpeed === 0 && sceneState === 'FORMED'} autoRotateSpeed={0.3} maxPolarAngle={Math.PI / 1.7} />

      <color attach="background" args={['#000300']} />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <Environment preset="night" background={false} />

      <ambientLight intensity={0.4} color="#003311" />
      <pointLight position={[30, 30, 30]} intensity={100} color={CONFIG.colors.warmLight} />
      <pointLight position={[-30, 10, -30]} intensity={50} color={CONFIG.colors.gold} />
      <pointLight position={[0, -20, 10]} intensity={30} color="#ffffff" />

      <group position={[0, -6, 0]}>
          <Foliage state={sceneState} />
          <Suspense fallback={null}>
            <PhotoOrnaments state={sceneState} photos={photos} />
           <ChristmasElements state={sceneState} />
           <FairyLights state={sceneState} />
           <TopStar state={sceneState} />
        </Suspense>
        <Sparkles count={600} scale={50} size={8} speed={0.4} opacity={0.4} color={CONFIG.colors.silver} />
      </group>

      <EffectComposer>
        <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.1} intensity={1.5} radius={0.5} mipmapBlur />
        <Vignette eskil={false} offset={0.1} darkness={1.2} />
      </EffectComposer>
    </>
  );
};

// --- Non-WebGL Fallback (2D Canvas) ---
const NonWebGLFallback = ({ sceneState, setSceneState, rotationSpeed, setRotationSpeed }: any) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ornamentCount = Math.min(100, CONFIG.counts.ornaments);

  // simple 2D projection of tree ornaments
  useEffect(() => {
    let raf = 0;
    const ctx = canvasRef.current?.getContext('2d');
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (!ctx || !canvasRef.current) return;
    canvasRef.current.width = width;
    canvasRef.current.height = height;

    const centerX = width / 2;
    const centerY = height / 2 + 60;
    const treeH = Math.min(300, height * 0.6);
    const treeR = treeH / 2;

    const ornaments = new Array(ornamentCount).fill(0).map(() => {
      const y = Math.random() * treeH;
      const normalizedY = y / treeH;
      const radius = treeR * (1 - normalizedY) * (0.8 + Math.random() * 0.4);
      const angle = Math.random() * Math.PI * 2;
      const x = centerX + radius * Math.cos(angle);
      const py = centerY - y;
      const size = 6 + Math.random() * 8;
      const color = CONFIG.colors.lights[Math.floor(Math.random() * CONFIG.colors.lights.length)];
      return { x, y: py, size, color, angle }; 
    });

    const render = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      // background
      ctx.fillStyle = '#000300'; ctx.fillRect(0, 0, width, height);
      // draw tree triangle
      ctx.fillStyle = '#004225';
      ctx.beginPath();
      ctx.moveTo(centerX, centerY - treeH - 20);
      ctx.lineTo(centerX - treeR - 20, centerY + 20);
      ctx.lineTo(centerX + treeR + 20, centerY + 20);
      ctx.closePath(); ctx.fill();

      // draw ornaments
      const time = t * 0.001;
      ornaments.forEach((o) => {
        const rot = time * (rotationSpeed || 0.2) + o.angle;
        const ox = centerX + (o.x - centerX) * Math.cos(rot) - (o.y - centerY) * Math.sin(rot);
        const oy = centerY + (o.x - centerX) * Math.sin(rot) + (o.y - centerY) * Math.cos(rot);
        ctx.beginPath(); ctx.fillStyle = o.color; ctx.arc(ox, oy, o.size * (sceneState === 'FORMED' ? 1 : 0.6), 0, Math.PI * 2); ctx.fill();
      });

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [sceneState, rotationSpeed]);

  return (
    <div style={{width:'100%',height:'100%',position:'relative'}}>
      <canvas ref={canvasRef} style={{width:'100%',height:'100%'}} />
      <div style={{position:'absolute',right:24,bottom:24,display:'flex',gap:10}}>
        <button onClick={() => setSceneState((s: 'CHAOS' | 'FORMED') => s === 'CHAOS' ? 'FORMED' : 'CHAOS')} style={{padding:'10px 16px',background:'#111',color:'#FFD700',border:'1px solid #444'}}>{'Toggle'}</button>
        <input type="range" min={-1} max={1} step={0.01} value={rotationSpeed} onChange={e => setRotationSpeed(parseFloat(e.target.value))} style={{width:160}} />
      </div>
    </div>
  );
};

// --- Gesture Controller ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GestureController = ({ onGesture, onMove, onStatus, debugMode, gpuAllowed, enableAI, onPick, onUnpick, photosCount, sceneState, permissiveOk, onDebug }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let gestureRecognizer: GestureRecognizer;
    let requestRef: number;

    const setup = async () => {
      if (!enableAI) {
        onStatus('AI DISABLED: fallback controls active');
        return;
      }
      onStatus("DOWNLOADING AI...");
      try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        // If GPU is explicitly not allowed (WebGL disabled), skip trying GPU to avoid repeated errors
        if (gpuAllowed === false) {
          gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
              delegate: "CPU"
            },
            runningMode: "VIDEO",
            numHands: 1
          });
        } else {
          // Try GPU delegate first, fallback to CPU if not available on this browser
          try {
            gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
                delegate: "GPU"
              },
              runningMode: "VIDEO",
              numHands: 1
            });
          } catch (gpuErr) {
            try {
              gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
                baseOptions: {
                  modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
                  delegate: "CPU"
                },
                runningMode: "VIDEO",
                numHands: 1
              });
              console.warn('Mediapipe: GPU delegate unavailable, using CPU fallback.');
            } catch (cpuErr) {
              throw cpuErr;
            }
          }
        }
        onStatus("REQUESTING CAMERA...");
        // Robust getUserMedia handling: modern Promise-based and legacy callback-based implementations
        const tryGetUserMedia = async () => {
          const md = (navigator as any).mediaDevices;
          if (md && md.getUserMedia) {
            return md.getUserMedia({ video: true });
          }
          const legacyGetUserMedia = (navigator as any).getUserMedia || (navigator as any).webkitGetUserMedia || (navigator as any).mozGetUserMedia || (navigator as any).msGetUserMedia;
          if (legacyGetUserMedia) {
            return new Promise((resolve, reject) => legacyGetUserMedia.call(navigator, { video: true }, resolve, reject));
          }
          throw new Error('getUserMedia not supported');
        };

        try {
          // require HTTPS or localhost for camera access in many browsers
          if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
            onStatus('ERROR: Camera requires HTTPS or localhost');
          } else {
            const stream = await tryGetUserMedia();
            if (videoRef.current) {
              videoRef.current.srcObject = stream as MediaStream;
              await videoRef.current.play().catch(() => null);
              onStatus("AI READY: SHOW HAND");
              predictWebcam();
            }
          }
        } catch (camErr: any) {
          onStatus(`ERROR: ${camErr?.message || 'CAMERA_ACCESS_FAILED'}`);
        }
      } catch (err: any) {
        onStatus(`ERROR: ${err.message || 'MODEL FAILED'}`);
      }
    };

    let lastPickTime = 0;
    const PICK_COOLDOWN = 800; // ms - shorter for responsiveness
    let okActive = false;
    let okFrameCount = 0;
    const OK_HOLD_FRAMES = 2; // require stability across frames
    let lastPickHandPos: { x: number; y: number } | null = null;
    const MOVE_UNPICK_THRESHOLD = 0.08; // normalized movement to cancel pick

    const predictWebcam = () => {
      if (gestureRecognizer && videoRef.current && canvasRef.current) {
        if (videoRef.current.videoWidth > 0) {
          const results = gestureRecognizer.recognizeForVideo(videoRef.current, Date.now());
            const ctx = canvasRef.current.getContext("2d");
            if (ctx && debugMode) {
                ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                canvasRef.current.width = videoRef.current.videoWidth; canvasRef.current.height = videoRef.current.videoHeight;
                if (results.landmarks) for (const landmarks of results.landmarks) {
                        const drawingUtils = new DrawingUtils(ctx);
                        drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: "#FFD700", lineWidth: 2 });
                        drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1 });
                }
            } else if (ctx && !debugMode) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

            if (results.gestures.length > 0) {
              const name = results.gestures[0][0].categoryName; const score = results.gestures[0][0].score;
              if (score > 0.4) {
                 if (name === "Open_Palm") onGesture("CHAOS"); if (name === "Closed_Fist") onGesture("FORMED");
                 if (debugMode) onStatus(`DETECTED: ${name}`);
              }
              if (results.landmarks.length > 0) {
                const speed = (0.5 - results.landmarks[0][0].x) * 0.15;
                onMove(Math.abs(speed) > 0.01 ? speed : 0);
              }
            } else { onMove(0); if (debugMode) onStatus("AI READY: NO HAND"); }
            // Custom OK-sign detection using landmarks (thumb tip index 4, index tip 8)
            if (results.landmarks && results.landmarks.length > 0) {
              try {
                const lm = results.landmarks[0];
                // landmark format: [{x,y,z}, ...]
                const pThumb = lm[4]; const pIndex = lm[8];
                const dx = pThumb.x - pIndex.x; const dy = pThumb.y - pIndex.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                // normalize by hand bbox (compute bbox width and diagonal once)
                let minX = 1, maxX = 0, minY = 1, maxY = 0;
                for (const p of lm) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
                const bboxW = Math.max(0.01, maxX - minX);
                const diag = Math.sqrt((maxX - minX) * (maxX - minX) + (maxY - minY) * (maxY - minY));
                const norm = dist / bboxW;
                const now = Date.now();
              // OK detection runs continuously. thresholds depend on scene and permissive flag.
              // Decide thresholds (relaxed when dispersed or permissiveOk enabled)
              const baseNormChaos = 0.22;
              const baseNormFormed = 0.12;
              const baseOtherChaos = 0.38;
              const baseOtherFormed = 0.48;
              const normThreshold = (sceneState === 'CHAOS' ? baseNormChaos : baseNormFormed) * (permissiveOk ? 1.25 : 1);
              const otherExtendThreshold = (sceneState === 'CHAOS' ? baseOtherChaos : baseOtherFormed) * (permissiveOk ? 0.85 : 1);

              // Check other fingers (middle=12, ring=16, pinky=20) are extended away from wrist
              const wrist = lm[0];
              const otherTips = [12, 16, 20];
              let otherExtended = true;
              for (const ti of otherTips) {
                const tp = lm[ti];
                const d = Math.sqrt((tp.x - wrist.x) * (tp.x - wrist.x) + (tp.y - wrist.y) * (tp.y - wrist.y));
                const nd = d / Math.max(0.001, diag);
                if (nd < otherExtendThreshold) { otherExtended = false; break; }
              }

              // OK detected when normalized thumb-index distance is small (threshold depends on scene)
              if (norm < normThreshold && otherExtended) {
                okFrameCount = Math.min(okFrameCount + 1, OK_HOLD_FRAMES);
              } else {
                okFrameCount = 0;
              }

              // stable OK across frames + other fingers extended -> trigger pick on rising edge
              if (okFrameCount >= OK_HOLD_FRAMES) {
                if (!okActive && typeof onPick === 'function' && photosCount > 0 && now - lastPickTime > PICK_COOLDOWN) {
                  lastPickTime = now;
                  okActive = true;
                  const idx = Math.floor(Math.random() * photosCount);
                  onPick(idx);
                  // store pick hand position to detect movement-based unpick
                  lastPickHandPos = { x: wrist.x, y: wrist.y };
                  if (debugMode) onStatus(`OK detected -> pick ${idx} (norm=${norm.toFixed(2)})`);
                }
              }

              // falling edge detection (OK released) - if thumb/index separate or other fingers collapse
              if (okActive && (norm >= normThreshold || okFrameCount === 0)) {
                okActive = false;
                lastPickHandPos = null;
                if (typeof onUnpick === 'function') onUnpick();
                if (debugMode) onStatus('OK released -> unpick');
              }

              // Movement-based unpick: if hand moved significantly from pick position
              if (okActive && lastPickHandPos) {
                const dxh = wrist.x - lastPickHandPos.x;
                const dyh = wrist.y - lastPickHandPos.y;
                const moveDist = Math.sqrt(dxh*dxh + dyh*dyh) / Math.max(0.001, diag);
                if (moveDist > MOVE_UNPICK_THRESHOLD) {
                  okActive = false;
                  lastPickHandPos = null;
                  if (typeof onUnpick === 'function') onUnpick();
                  if (debugMode) onStatus(`Hand moved -> unpick (move=${moveDist.toFixed(3)})`);
                }
              }
                // debug: emit computed normalized distances via onDebug/onStatus
                try {
                  const otherDistsArr = [12,16,20].map(i => {
                    const tp = lm[i]; const wrist = lm[0];
                    const d = Math.sqrt((tp.x - wrist.x) * (tp.x - wrist.x) + (tp.y - wrist.y) * (tp.y - wrist.y));
                    return (d / Math.max(0.001, Math.sqrt((maxX-minX)*(maxX-minX) + (maxY-minY)*(maxY-minY))));
                  });
                  const otherDists = otherDistsArr.map(n=>n.toFixed(2)).join(',');
                  const read = `norm=${norm.toFixed(2)} others=${otherDists} scene=${sceneState} permissive=${Boolean(permissiveOk)}`;
                  if (typeof onDebug === 'function') onDebug(read);
                  if (debugMode) onStatus(read);
                } catch(e) { /* ignore debug errors */ }
              } catch (e) {
                // ignore
              }
            }
        }
        requestRef = requestAnimationFrame(predictWebcam);
      }
    };
    setup();
    return () => cancelAnimationFrame(requestRef);
  }, [onGesture, onMove, onStatus, debugMode]);

  return (
    <>
      <video ref={videoRef} style={{ opacity: debugMode ? 0.6 : 0, position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', zIndex: debugMode ? 100 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} playsInline muted autoPlay />
      <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', height: debugMode ? 'auto' : '1px', zIndex: debugMode ? 101 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} />
    </>
  );
};

// --- App Entry ---
export default function GrandTreeApp() {
  const [sceneState, setSceneState] = useState<'CHAOS' | 'FORMED'>('CHAOS');
  const [rotationSpeed, setRotationSpeed] = useState(0);
  const [aiStatus, setAiStatus] = useState("INITIALIZING...");
  const [debugMode, setDebugMode] = useState(false);

  // Synchronously detect WebGL availability so we won't mount the <Canvas> and avoid Three.js throwing
  const webglAvailable = useMemo(() => {
    try {
      if (typeof window === 'undefined' || typeof document === 'undefined') return false;
      const canvas = document.createElement('canvas');
      const hasContext = !!(canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
      return Boolean((window as any).WebGLRenderingContext) && hasContext;
    } catch (e) {
      return false;
    }
  }, []);

  // Check which photo files actually exist on the server so missing files don't crash texture loading
  const [photosReady, setPhotosReady] = useState(false);
  const [availablePhotos, setAvailablePhotos] = useState<string[]>([]);
  const [zoomPhotoIndex, setZoomPhotoIndex] = useState<number|null>(null);
  const [zoomVisible, setZoomVisible] = useState(false);
  const [zoomMounted, setZoomMounted] = useState(false);
  const [permissiveOk, setPermissiveOk] = useState(false);
  const [okReadout, setOkReadout] = useState('');

  // helper to show overlay with animation
  const showZoom = (idx: number) => {
    setZoomPhotoIndex(idx);
    setZoomMounted(true);
    // allow mount then animate in
    requestAnimationFrame(() => setZoomVisible(true));
  };

  // helper to hide overlay with animation
  const hideZoom = () => {
    setZoomVisible(false);
    // unmount after transition (300ms)
    setTimeout(() => { setZoomMounted(false); setZoomPhotoIndex(null); }, 350);
  };

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const checks = await Promise.allSettled(
        bodyPhotoPaths.map(async (path) => {
          try {
            const res = await fetch(path, { method: 'HEAD' });
            return res.ok ? path : null;
          } catch (e) {
            return null;
          }
        })
      );
      if (!mounted) return;
      const found = checks.map(c => (c.status === 'fulfilled' ? c.value : null)).filter(Boolean) as string[];
      // Ensure at least one image is available; fall back to top.jpg path if present
      if (found.length === 0) {
        try {
          const r = await fetch('/photos/top.jpg', { method: 'HEAD' });
          if (r.ok) setAvailablePhotos(['/photos/top.jpg']);
          else setAvailablePhotos([]);
        } catch (e) {
          setAvailablePhotos([]);
        }
      } else {
        setAvailablePhotos(found);
      }
      setPhotosReady(true);
    };
    check();
    return () => { mounted = false; };
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
      {!webglAvailable && (
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',zIndex:50,background:'#000'}}>
          <div style={{color:'#FFD700',textAlign:'center',maxWidth:920,padding:24,fontFamily:'sans-serif'}}>
            <h2 style={{marginTop:0}}>WebGL Not Available — using lightweight fallback</h2>
            <p style={{color:'#fff',opacity:0.9}}>Your browser or environment does not support WebGL. A simplified experience is shown below that works without GPU or additional browser configuration.</p>
            <p style={{marginTop:12}}><a href="https://get.webgl.org/" target="_blank" rel="noreferrer" style={{color:'#FFD700'}}>Learn about WebGL support</a></p>
          </div>
        </div>
      )}
      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
        {webglAvailable ? (
          photosReady ? (
            <Canvas dpr={[1, 2]} gl={{ toneMapping: THREE.ReinhardToneMapping }} shadows>
                <Experience sceneState={sceneState} rotationSpeed={rotationSpeed} photos={availablePhotos} />
            </Canvas>
          ) : (
            <div style={{color:'#FFD700',display:'flex',alignItems:'center',justifyContent:'center',height:'100%'}}>Checking photos...</div>
          )
        ) : (
          <NonWebGLFallback sceneState={sceneState} setSceneState={setSceneState} rotationSpeed={rotationSpeed} setRotationSpeed={setRotationSpeed} />
        )}
      </div>
      <GestureController onGesture={setSceneState} onMove={setRotationSpeed} onStatus={setAiStatus} debugMode={debugMode} gpuAllowed={webglAvailable} enableAI={webglAvailable && !!(navigator && ((navigator as any).mediaDevices && (navigator as any).mediaDevices.getUserMedia)) && (location.protocol === 'https:' || location.hostname === 'localhost')} onPick={(i:number)=>{ showZoom(i); }} onUnpick={() => { hideZoom(); }} photosCount={availablePhotos.length} sceneState={sceneState} permissiveOk={permissiveOk} onDebug={(s:string)=>setOkReadout(s)} />

      {/* Zoom overlay for picked photo (from OK sign) with animation */}
      {zoomMounted && zoomPhotoIndex !== null && availablePhotos[zoomPhotoIndex] && (
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',zIndex:2000,pointerEvents: zoomVisible ? 'auto' : 'none'}}>
          <div style={{position:'relative',background:'rgba(0,0,0,0.6)',padding:20,borderRadius:12,transition:'opacity 300ms ease, transform 300ms ease',opacity: zoomVisible ? 1 : 0, transform: zoomVisible ? 'scale(1)' : 'scale(0.96)'}}>
            <img src={availablePhotos[zoomPhotoIndex]} style={{maxWidth:'80vw',maxHeight:'80vh',display:'block',border:`8px solid ${CONFIG.colors.gold}`,borderRadius:8}} alt="picked" />
            <div style={{textAlign:'center',marginTop:12}}>
              <button onClick={() => hideZoom()} style={{padding:'8px 12px',background:'#222',color:'#FFD700',border:'1px solid #444'}}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* UI - Stats */}
      <div style={{ position: 'absolute', bottom: '30px', left: '40px', color: '#888', zIndex: 10, fontFamily: 'sans-serif', userSelect: 'none' }}>
        <div style={{ marginBottom: '15px' }}>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Memories</p>
          <p style={{ fontSize: '24px', color: '#FFD700', fontWeight: 'bold', margin: 0 }}>
            {CONFIG.counts.ornaments.toLocaleString()} <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>POLAROIDS</span>
          </p>
        </div>
        <div>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Foliage</p>
          <p style={{ fontSize: '24px', color: '#004225', fontWeight: 'bold', margin: 0 }}>
            {(CONFIG.counts.foliage / 1000).toFixed(0)}K <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>EMERALD NEEDLES</span>
          </p>
        </div>
      </div>

      {/* UI - Buttons */}
      <div style={{ position: 'absolute', bottom: '30px', right: '40px', zIndex: 10, display: 'flex', gap: '10px' }}>
        <button onClick={() => setDebugMode(!debugMode)} style={{ padding: '12px 15px', backgroundColor: debugMode ? '#FFD700' : 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: debugMode ? '#000' : '#FFD700', fontFamily: 'sans-serif', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           {debugMode ? 'HIDE DEBUG' : '🛠 DEBUG'}
        </button>
        <button onClick={() => setPermissiveOk(p => !p)} style={{ padding: '12px 15px', backgroundColor: permissiveOk ? '#4CAF50' : 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.08)', color: permissiveOk ? '#000' : '#FFD700', fontFamily: 'sans-serif', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer' }}>
           {permissiveOk ? 'Permissive OK: ON' : 'Permissive OK: OFF'}
        </button>
        <button onClick={() => setSceneState(s => s === 'CHAOS' ? 'FORMED' : 'CHAOS')} style={{ padding: '12px 30px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255, 215, 0, 0.5)', color: '#FFD700', fontFamily: 'serif', fontSize: '14px', fontWeight: 'bold', letterSpacing: '3px', textTransform: 'uppercase', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           {sceneState === 'CHAOS' ? 'Assemble Tree' : 'Disperse'}
        </button>
      </div>

      {/* OK detection numeric readout (helps tuning) */}
      {(debugMode || permissiveOk) && (
        <div style={{ position: 'absolute', top: 48, left: '50%', transform: 'translateX(-50%)', color: '#FFD700', fontSize: '11px', zIndex: 11, background: 'rgba(0,0,0,0.45)', padding: '6px 10px', borderRadius: 6 }}>
          {okReadout || 'OK readout: —'}
        </div>
      )}

      {/* UI - AI Status */}
      <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', color: aiStatus.includes('ERROR') ? '#FF0000' : 'rgba(255, 215, 0, 0.4)', fontSize: '10px', letterSpacing: '2px', zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '4px' }}>
        {aiStatus}
      </div>
    </div>
  );
}