import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type {
  ComponentType,
  Position,
  SimulationComponent,
} from '../circuit/models';

interface Scene3DProps {
  components: SimulationComponent[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddComponent: (type: ComponentType, position: Position) => void;
  onMoveComponent: (id: string, position: Position) => void;
  onRotateComponent: (id: string, rotationY: number) => void;
  onToggleSwitch: (id: string) => void;
}

interface ComponentVisuals {
  switchBase?: THREE.Mesh;
  switchLever?: THREE.Mesh;
  bulb?: THREE.Mesh;
  body?: THREE.Mesh;
  redLight?: THREE.Mesh;
  yellowLight?: THREE.Mesh;
  greenLight?: THREE.Mesh;
}

const WORLD_SCALE = 40;
const X_OFFSET = 400;
const Z_OFFSET = 300;

function stateToWorld(position: Position): THREE.Vector3 {
  return new THREE.Vector3(
    (position.x - X_OFFSET) / WORLD_SCALE,
    0,
    (position.y - Z_OFFSET) / WORLD_SCALE,
  );
}

function worldToState(position: THREE.Vector3): Position {
  return {
    x: Math.max(0, Math.round(position.x * WORLD_SCALE + X_OFFSET)),
    y: Math.max(0, Math.round(position.z * WORLD_SCALE + Z_OFFSET)),
  };
}

function setMeshColor(
  mesh: THREE.Mesh | undefined,
  color: number,
  emissive = 0x000000,
): void {
  if (!mesh) {
    return;
  }

  const material = mesh.material;
  if (material instanceof THREE.MeshStandardMaterial) {
    material.color.setHex(color);
    material.emissive.setHex(emissive);
  }
}

function createComponentObject(component: SimulationComponent): THREE.Group {
  const group = new THREE.Group();
  group.userData.componentId = component.id;
  group.userData.componentType = component.type;

  const visuals: ComponentVisuals = {};

  if (component.type === 'switch') {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.2, 1),
      new THREE.MeshStandardMaterial({ color: 0x6b5e4f }),
    );
    base.position.y = 0.1;

    const lever = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.7, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xd8d1c3 }),
    );
    lever.position.y = 0.55;

    group.add(base, lever);
    visuals.switchBase = base;
    visuals.switchLever = lever;
  } else if (component.type === 'lightBulb') {
    const stand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.3, 0.3, 20),
      new THREE.MeshStandardMaterial({ color: 0x615545 }),
    );
    stand.position.y = 0.15;

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 24, 18),
      new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0x000000 }),
    );
    bulb.position.y = 0.62;

    group.add(stand, bulb);
    visuals.bulb = bulb;
  } else if (component.type === 'trafficLight') {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 2.2, 16),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a }),
    );
    pole.position.y = 1.1;

    const housing = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 1.6, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x111111 }),
    );
    housing.position.set(0, 2.0, 0);

    const redLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0x441818, emissive: 0x000000 }),
    );
    redLight.position.set(0, 2.45, 0.24);

    const yellowLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0x4a3b10, emissive: 0x000000 }),
    );
    yellowLight.position.set(0, 2.0, 0.24);

    const greenLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0x13351b, emissive: 0x000000 }),
    );
    greenLight.position.set(0, 1.55, 0.24);

    group.add(pole, housing, redLight, yellowLight, greenLight);
    visuals.redLight = redLight;
    visuals.yellowLight = yellowLight;
    visuals.greenLight = greenLight;
  } else {
    const isTrafficController = component.type === 'trafficController';
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.9, 1),
      new THREE.MeshStandardMaterial({
        color: isTrafficController ? 0x365f8a : 0x4d627f,
      }),
    );
    body.position.y = 0.45;
    group.add(body);
    visuals.body = body;
  }

  group.userData.visuals = visuals;
  return group;
}

function syncVisualState(
  component: SimulationComponent,
  group: THREE.Group,
): void {
  const visuals = group.userData.visuals as ComponentVisuals;

  if (component.type === 'switch') {
    const isOn = Boolean(component.outputs.out);
    if (visuals.switchLever) {
      visuals.switchLever.rotation.x = isOn ? -0.6 : 0.6;
    }
    setMeshColor(visuals.switchBase, isOn ? 0x2f7f4a : 0x6b5e4f);
    return;
  }

  if (component.type === 'lightBulb') {
    const lit = Boolean(component.outputs.lit);
    setMeshColor(
      visuals.bulb,
      lit ? 0xffd44d : 0x7f7f7f,
      lit ? 0x8a6400 : 0x000000,
    );
    return;
  }

  if (component.type === 'trafficLight') {
    const red = Boolean(component.inputs.red);
    const yellow = !red && Boolean(component.inputs.yellow);
    const green = !red && !yellow && Boolean(component.inputs.green);

    setMeshColor(
      visuals.redLight,
      red ? 0xff3b3b : 0x441818,
      red ? 0x9a1e1e : 0x000000,
    );
    setMeshColor(
      visuals.yellowLight,
      yellow ? 0xffd700 : 0x4a3b10,
      yellow ? 0x8a6f00 : 0x000000,
    );
    setMeshColor(
      visuals.greenLight,
      green ? 0x22c55e : 0x13351b,
      green ? 0x126536 : 0x000000,
    );
    return;
  }

  const hasError = Boolean(component.lastError);
  if (component.type === 'trafficController') {
    setMeshColor(visuals.body, hasError ? 0x8f2f2f : 0x365f8a);
    return;
  }

  setMeshColor(visuals.body, hasError ? 0x8f2f2f : 0x4d627f);
}

function getComponentGroup(target: THREE.Object3D | null): THREE.Group | null {
  let current = target;
  while (current) {
    if (current.userData.componentId) {
      return current as THREE.Group;
    }
    current = current.parent;
  }
  return null;
}

export default function SimulationScene3D({
  components,
  selectedId,
  onSelect,
  onAddComponent,
  onMoveComponent,
  onRotateComponent,
  onToggleSwitch,
}: Scene3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const frameRef = useRef<number | null>(null);

  const idToObjectRef = useRef(new Map<string, THREE.Group>());
  const raycasterRef = useRef(new THREE.Raycaster());
  const pointerRef = useRef(new THREE.Vector2());
  const dragPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));

  const interactionRef = useRef<{
    mode: 'none' | 'move' | 'rotate';
    id: string | null;
    pointerDownX: number;
    pointerDownY: number;
    moved: boolean;
    startRotation: number;
    moveOffset: THREE.Vector3;
  }>({
    mode: 'none',
    id: null,
    pointerDownX: 0,
    pointerDownY: 0,
    moved: false,
    startRotation: 0,
    moveOffset: new THREE.Vector3(),
  });

  const latestRef = useRef({
    components,
    onSelect,
    onAddComponent,
    onMoveComponent,
    onRotateComponent,
    onToggleSwitch,
  });

  useEffect(() => {
    latestRef.current = {
      components,
      onSelect,
      onAddComponent,
      onMoveComponent,
      onRotateComponent,
      onToggleSwitch,
    };
  }, [
    components,
    onSelect,
    onAddComponent,
    onMoveComponent,
    onRotateComponent,
    onToggleSwitch,
  ]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0ecdf);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    camera.position.set(9, 11, 11);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.shadowMap.enabled = true;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    const directional = new THREE.DirectionalLight(0xffffff, 0.9);
    directional.position.set(7, 12, 4);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: 0xe9e2cf }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;

    const grid = new THREE.GridHelper(80, 80, 0xbfae8b, 0xd2c2a5);
    grid.position.y = 0;

    scene.add(ambient, directional, floor, grid);

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;
    controlsRef.current = controls;

    const updatePointer = (event: PointerEvent | DragEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      pointerRef.current.set(x, y);
    };

    const pickGroup = (event: PointerEvent): THREE.Group | null => {
      const cam = cameraRef.current;
      if (!cam) {
        return null;
      }

      updatePointer(event);
      raycasterRef.current.setFromCamera(pointerRef.current, cam);
      const roots = Array.from(idToObjectRef.current.values());
      const intersections = raycasterRef.current.intersectObjects(roots, true);
      if (!intersections.length) {
        return null;
      }

      return getComponentGroup(intersections[0].object);
    };

    const startInteraction = (
      event: PointerEvent,
      mode: 'move' | 'rotate',
      group: THREE.Group,
    ) => {
      const cam = cameraRef.current;
      if (!cam) {
        return;
      }

      controls.enabled = false;
      interactionRef.current.mode = mode;
      interactionRef.current.id = String(group.userData.componentId);
      interactionRef.current.pointerDownX = event.clientX;
      interactionRef.current.pointerDownY = event.clientY;
      interactionRef.current.moved = false;
      interactionRef.current.startRotation = group.rotation.y;

      if (mode === 'move') {
        updatePointer(event);
        raycasterRef.current.setFromCamera(pointerRef.current, cam);
        const hitPoint = new THREE.Vector3();
        if (
          raycasterRef.current.ray.intersectPlane(
            dragPlaneRef.current,
            hitPoint,
          )
        ) {
          interactionRef.current.moveOffset.copy(group.position).sub(hitPoint);
        } else {
          interactionRef.current.moveOffset.set(0, 0, 0);
        }
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      const hitGroup = pickGroup(event);

      if (!hitGroup) {
        latestRef.current.onSelect(null);
        return;
      }

      const id = String(hitGroup.userData.componentId);
      latestRef.current.onSelect(id);

      const mode = event.shiftKey ? 'rotate' : 'move';
      startInteraction(event, mode, hitGroup);
    };

    const onPointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (interaction.mode === 'none' || !interaction.id) {
        return;
      }

      const group = idToObjectRef.current.get(interaction.id);
      const cam = cameraRef.current;
      if (!group || !cam) {
        return;
      }

      if (
        Math.abs(event.clientX - interaction.pointerDownX) > 2 ||
        Math.abs(event.clientY - interaction.pointerDownY) > 2
      ) {
        interaction.moved = true;
      }

      if (interaction.mode === 'rotate') {
        const delta = (event.clientX - interaction.pointerDownX) * 0.012;
        const nextRotation = interaction.startRotation + delta;
        group.rotation.y = nextRotation;
        latestRef.current.onRotateComponent(interaction.id, nextRotation);
        return;
      }

      updatePointer(event);
      raycasterRef.current.setFromCamera(pointerRef.current, cam);
      const hitPoint = new THREE.Vector3();
      if (
        !raycasterRef.current.ray.intersectPlane(dragPlaneRef.current, hitPoint)
      ) {
        return;
      }

      const nextPosition = hitPoint.add(interaction.moveOffset);
      group.position.x = nextPosition.x;
      group.position.z = nextPosition.z;
      latestRef.current.onMoveComponent(
        interaction.id,
        worldToState(nextPosition),
      );
    };

    const onPointerUp = () => {
      const interaction = interactionRef.current;
      controls.enabled = true;

      if (!interaction.id) {
        interaction.mode = 'none';
        return;
      }

      if (!interaction.moved && interaction.mode === 'move') {
        const component = latestRef.current.components.find(
          (item) => item.id === interaction.id,
        );
        if (component?.type === 'switch') {
          latestRef.current.onToggleSwitch(component.id);
        }
      }

      interaction.mode = 'none';
      interaction.id = null;
      interaction.moved = false;
    };

    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
    };

    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer?.getData(
        'application/component-type',
      ) as ComponentType;
      if (!type || !cameraRef.current) {
        return;
      }

      updatePointer(event);
      raycasterRef.current.setFromCamera(pointerRef.current, cameraRef.current);
      const hitPoint = new THREE.Vector3();
      if (
        !raycasterRef.current.ray.intersectPlane(dragPlaneRef.current, hitPoint)
      ) {
        return;
      }

      latestRef.current.onAddComponent(type, worldToState(hitPoint));
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointerleave', onPointerUp);

    host.addEventListener('dragover', onDragOver);
    host.addEventListener('drop', onDrop);

    const resizeObserver = new ResizeObserver(() => {
      const node = hostRef.current;
      const cam = cameraRef.current;
      const rend = rendererRef.current;
      if (!node || !cam || !rend) {
        return;
      }

      const width = Math.max(1, node.clientWidth);
      const height = Math.max(1, node.clientHeight);
      cam.aspect = width / height;
      cam.updateProjectionMatrix();
      rend.setSize(width, height);
    });
    resizeObserver.observe(host);

    const renderFrame = () => {
      controls.update();
      renderer.render(scene, camera);
      frameRef.current = window.requestAnimationFrame(renderFrame);
    };

    renderFrame();

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }

      resizeObserver.disconnect();
      host.removeEventListener('dragover', onDragOver);
      host.removeEventListener('drop', onDrop);

      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointerleave', onPointerUp);

      controls.dispose();
      renderer.dispose();

      idToObjectRef.current.forEach((group) => {
        group.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.geometry.dispose();
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach((material) => material.dispose());
            } else {
              mesh.material.dispose();
            }
          }
        });
      });

      if (renderer.domElement.parentElement === host) {
        host.removeChild(renderer.domElement);
      }

      idToObjectRef.current.clear();
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) {
      return;
    }

    const nextIds = new Set(components.map((component) => component.id));

    idToObjectRef.current.forEach((group, id) => {
      if (nextIds.has(id)) {
        return;
      }
      scene.remove(group);
      idToObjectRef.current.delete(id);
    });

    components.forEach((component) => {
      let group = idToObjectRef.current.get(component.id);

      if (!group) {
        group = createComponentObject(component);
        idToObjectRef.current.set(component.id, group);
        scene.add(group);
      }

      const world = stateToWorld(component.position);
      group.position.x = world.x;
      group.position.z = world.z;
      group.position.y = 0;
      group.rotation.y = component.rotationY ?? 0;
      group.scale.setScalar(selectedId === component.id ? 1.08 : 1);

      syncVisualState(component, group);
    });
  }, [components, selectedId]);

  return (
    <div
      ref={hostRef}
      className="scene3d-host"
      aria-label="3D simulation scene"
    />
  );
}
