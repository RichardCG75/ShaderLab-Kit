// The three.js scene of the preview: renderer, camera with orbit controls, one directional light plus
// ambient, and the preview mesh. The material is supplied by material.ts.

import * as three from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MeshKind, SceneSettings } from '../preview/protocol';

function createGeometry(kind: MeshKind): three.BufferGeometry {
	switch (kind) {
		case 'sphere': return new three.SphereGeometry(1, 96, 48);
		case 'cube': return new three.BoxGeometry(1.4, 1.4, 1.4);
		case 'plane': return new three.PlaneGeometry(2, 2);
		case 'cylinder': return new three.CylinderGeometry(0.8, 0.8, 1.6, 96);
		case 'torus': return new three.TorusGeometry(0.75, 0.3, 64, 128);
	}
}

const CAMERA_START = new three.Vector3(0, 0.6, 3.2);

export class PreviewScene {
	private readonly renderer: three.WebGLRenderer;
	private readonly scene = new three.Scene();
	private readonly camera = new three.PerspectiveCamera(40, 1, 0.05, 100);
	private readonly controls: OrbitControls;
	private readonly light = new three.DirectionalLight(0xffffff, 2.5);
	private readonly ambient = new three.AmbientLight(0xffffff, 0.6);
	private readonly mesh: three.Mesh;
	private meshKind: MeshKind | undefined;
	private autoRotate = false;
	private readonly clock = new three.Clock();
	private readonly resizeObserver: ResizeObserver;

	/** Throws if WebGL is unavailable. */
	constructor(private readonly container: HTMLElement) {
		this.renderer = new three.WebGLRenderer({ antialias: true, alpha: false });
		this.renderer.setPixelRatio(window.devicePixelRatio);
		this.renderer.outputColorSpace = three.SRGBColorSpace;
		this.renderer.toneMapping = three.NoToneMapping;
		container.appendChild(this.renderer.domElement);

		this.camera.position.copy(CAMERA_START);
		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.minDistance = 1.2;
		this.controls.maxDistance = 12;

		this.scene.add(this.light, this.ambient);
		this.mesh = new three.Mesh(createGeometry('sphere'), new three.MeshStandardMaterial());
		this.meshKind = 'sphere';
		this.scene.add(this.mesh);

		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(container);
		this.resize();
		this.renderer.setAnimationLoop(() => this.frame());
	}

	private resize(): void {
		const width = Math.max(1, this.container.clientWidth);
		const height = Math.max(1, this.container.clientHeight);
		this.renderer.setSize(width, height, false);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
	}

	private frame(): void {
		const delta = this.clock.getDelta();
		if (this.autoRotate) {
			this.mesh.rotation.y += delta * 0.5;
		}
		this.controls.update();
		this.renderer.render(this.scene, this.camera);
	}

	setMaterial(material: three.Material): void {
		const previous = this.mesh.material as three.Material;
		this.mesh.material = material;
		if (previous !== material) {
			previous.dispose();
		}
	}

	applySettings(settings: SceneSettings): void {
		if (settings.mesh !== this.meshKind) {
			this.mesh.geometry.dispose();
			this.mesh.geometry = createGeometry(settings.mesh);
			this.meshKind = settings.mesh;
		}
		const azimuth = three.MathUtils.degToRad(settings.lightAzimuth);
		const elevation = three.MathUtils.degToRad(settings.lightElevation);
		this.light.position.set(
			Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth),
		).multiplyScalar(5);
		this.light.intensity = settings.lightIntensity;
		this.ambient.intensity = settings.ambientIntensity;
		this.scene.background = new three.Color(settings.background);
		this.autoRotate = settings.autoRotate;
		if (!settings.autoRotate) {
			this.mesh.rotation.set(0, this.mesh.rotation.y, 0);
		}
	}

	resetView(): void {
		this.camera.position.copy(CAMERA_START);
		this.controls.target.set(0, 0, 0);
		this.mesh.rotation.set(0, 0, 0);
		this.controls.update();
	}
}
