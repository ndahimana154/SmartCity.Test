import * as THREE from 'three';
import type { PLCTelemetry } from './SmartPLC';

/**
 * VisualPLC is a Three.js-only adapter for SmartPLC telemetry.
 * It does not compute traffic logic and can be safely removed without affecting simulation behavior.
 */
export class VisualPLC {
    readonly plcId: string;
    readonly root: THREE.Group;

    private panel: THREE.Mesh;
    private statusLed: THREE.Mesh;
    private emergencyLed: THREE.Mesh;
    private screen: THREE.Mesh;
    private screenCanvas: HTMLCanvasElement;
    private screenTexture: THREE.CanvasTexture;
    private disposed = false;

    constructor(plcId: string) {
        this.plcId = plcId;
        this.root = new THREE.Group();
        this.root.name = `visual-plc-${plcId}`;

        this.panel = new THREE.Mesh(
            new THREE.BoxGeometry(2.4, 1.2, 0.9),
            new THREE.MeshStandardMaterial({ color: 0x2f3f53 }),
        );

        this.statusLed = new THREE.Mesh(
            new THREE.SphereGeometry(0.09, 14, 12),
            new THREE.MeshStandardMaterial({ color: 0x224422, emissive: 0x000000 }),
        );
        this.statusLed.position.set(-0.9, 0.35, 0.5);

        this.emergencyLed = new THREE.Mesh(
            new THREE.SphereGeometry(0.09, 14, 12),
            new THREE.MeshStandardMaterial({ color: 0x442222, emissive: 0x000000 }),
        );
        this.emergencyLed.position.set(-0.65, 0.35, 0.5);

        this.screenCanvas = document.createElement('canvas');
        this.screenCanvas.width = 512;
        this.screenCanvas.height = 256;
        this.screenTexture = new THREE.CanvasTexture(this.screenCanvas);

        this.screen = new THREE.Mesh(
            new THREE.PlaneGeometry(1.5, 0.72),
            new THREE.MeshBasicMaterial({ map: this.screenTexture }),
        );
        this.screen.position.set(0.35, 0.02, 0.46);

        this.root.add(this.panel, this.statusLed, this.emergencyLed, this.screen);

        this.drawScreen('PLC ONLINE', ['Waiting telemetry...']);
    }

    attachTo(scene: THREE.Scene): void {
        scene.add(this.root);
    }

    detachFrom(scene: THREE.Scene): void {
        scene.remove(this.root);
    }

    setPosition(x: number, y: number, z: number): void {
        this.root.position.set(x, y, z);
    }

    updateFromTelemetry(telemetry: PLCTelemetry): void {
        if (this.disposed) {
            return;
        }

        const intersections = Object.values(telemetry.intersections);
        const emergencyActive = intersections.some((item) => item.emergencyActive);

        this.setLed(this.statusLed, 0x33cc66, intersections.length > 0);
        this.setLed(this.emergencyLed, 0xff4444, emergencyActive);

        const lineItems: string[] = [];
        intersections.slice(0, 4).forEach((item, index) => {
            lineItems.push(
                `${index + 1}. ${item.currentPhase} | t-${item.timeRemaining.toFixed(1)}s | VPM ${item.throughputVpm.toFixed(1)}`,
            );
        });

        this.drawScreen(`PLC ${telemetry.plcId}`, lineItems.length ? lineItems : ['No intersections']);
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;

        [this.panel, this.statusLed, this.emergencyLed, this.screen].forEach((mesh) => {
            mesh.geometry.dispose();
            const mat = mesh.material;
            if (Array.isArray(mat)) {
                mat.forEach((m) => m.dispose());
            } else {
                mat.dispose();
            }
        });

        this.screenTexture.dispose();
    }

    private setLed(led: THREE.Mesh, color: number, active: boolean): void {
        const material = led.material;
        if (!(material instanceof THREE.MeshStandardMaterial)) {
            return;
        }

        material.color.setHex(active ? color : 0x222222);
        material.emissive.setHex(active ? color : 0x000000);
    }

    private drawScreen(title: string, lines: string[]): void {
        const context = this.screenCanvas.getContext('2d');
        if (!context) {
            return;
        }

        context.fillStyle = '#081821';
        context.fillRect(0, 0, this.screenCanvas.width, this.screenCanvas.height);

        context.fillStyle = '#6ff3a6';
        context.font = 'bold 28px monospace';
        context.fillText(title, 18, 36);

        context.font = '20px monospace';
        lines.slice(0, 8).forEach((line, index) => {
            context.fillText(line, 18, 74 + index * 24);
        });

        this.screenTexture.needsUpdate = true;
    }
}
