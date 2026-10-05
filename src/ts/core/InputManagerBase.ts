import { World } from '../world/World';
import * as THREE from 'three';
import { IInputReceiver } from '../interfaces/IInputReceiver';
import { EntityType } from '../enums/EntityType';
import { IUpdatable } from '../interfaces/IUpdatable';

export class InputManagerBase implements IUpdatable
{
	public updateOrder: number = 3;
	
	public world: World;
	public domElement: any;
	public pointerLock: any;
	public isLocked: boolean;
	public inputReceivers: IInputReceiver[] = [];
	private dragging = false;
	private lastMouseX = 0;
	private lastMouseY = 0;
	private heldMouseButtons = new Set<number>();
	private heldKeys = new Set<string>();

	public boundOnMouseDown: (evt: any) => void;
	public boundOnMouseMove: (evt: any) => void;
	public boundOnMouseUp: (evt: any) => void;
	public boundOnMouseWheelMove: (evt: any) => void;
	public boundOnPointerlockChange: (evt: any) => void;
	public boundOnPointerlockError: (evt: any) => void;
	public boundOnKeyDown: (evt: any) => void;
	public boundOnKeyUp: (evt: any) => void;
	
	

	constructor(world: World, domElement: HTMLElement)
	{
		this.world = world;
		this.pointerLock = world.params.Pointer_Lock;
		this.domElement = domElement;
		this.domElement.tabIndex = 0;
		this.isLocked = false;
		
		// Bindings for later event use
		// Mouse
		this.boundOnMouseDown = (evt) => this.onMouseDown(evt);
		this.boundOnMouseMove = (evt) => this.onMouseMove(evt);
		this.boundOnMouseUp = (evt) => this.onMouseUp(evt);
		this.boundOnMouseWheelMove = (evt) => this.onMouseWheelMove(evt);

		// Pointer lock
		this.boundOnPointerlockChange = (evt) => this.onPointerlockChange(evt);
		this.boundOnPointerlockError = (evt) => this.onPointerlockError(evt);

		// Keys
		this.boundOnKeyDown = (evt) => this.onKeyDown(evt);
		this.boundOnKeyUp = (evt) => this.onKeyUp(evt);

		// Init event listeners
		// Mouse
		this.domElement.addEventListener('mousedown', this.boundOnMouseDown, false);
		document.addEventListener('mousemove', this.boundOnMouseMove, false);
		document.addEventListener('mouseup', this.boundOnMouseUp, false);
		this.domElement.addEventListener('contextmenu', event => event.preventDefault());
		window.addEventListener('blur', () => this.releaseInput());
		document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseInput(); });
		document.addEventListener('wheel', this.boundOnMouseWheelMove, false);
		document.addEventListener('pointerlockchange', this.boundOnPointerlockChange, false);
		document.addEventListener('pointerlockerror', this.boundOnPointerlockError, false);
		
		// Keys
		document.addEventListener('keydown', this.boundOnKeyDown, false);
		document.addEventListener('keyup', this.boundOnKeyUp, false);

		world.registerUpdatable(this);				
	}
	
	
	public update(timestep: number, unscaledTimeStep: number): void
	{
		if (this.inputReceivers.length === 0 && this.world !== undefined && this.world.cameraOperator !== undefined)
		{
			this.setInputReceivers(this.world.cameraOperator);
		}

		this.inputReceivers.forEach(receiver => receiver.inputReceiverUpdate(unscaledTimeStep));
		if (!this.world.sceneEditor?.active && this.heldKeys.size) {
			const x = Number(this.heldKeys.has('ArrowRight')) - Number(this.heldKeys.has('ArrowLeft'));
			const y = Number(this.heldKeys.has('ArrowDown')) - Number(this.heldKeys.has('ArrowUp'));
			if (x || y) this.world.cameraOperator.move(x * 180 * unscaledTimeStep, y * 180 * unscaledTimeStep);
		}
	}

	public setInputReceivers(...receivers: IInputReceiver[]): void
	{
		this.inputReceivers = receivers;
		this.inputReceivers.forEach(receiver => receiver.inputReceiverInit());
	}

	public setPointerLock(enabled: boolean): void
	{
		this.pointerLock = enabled;
	}

	public onPointerlockChange(event: MouseEvent): void
	{
		this.isLocked = document.pointerLockElement === this.domElement;
		if (!this.isLocked) this.releaseInput();
	}

	public onPointerlockError(event: MouseEvent): void
	{
		//console.error('PointerLockControls: Unable to use Pointer Lock API');
	}

	public onMouseDown(event: MouseEvent): void
	{
		if (this.ignoreInput(event)) return;
		this.domElement.focus();
		if (event.button === 0 || event.button === 2) {
			this.heldMouseButtons.add(event.button);
			this.dragging = true;
			this.lastMouseX = event.clientX; this.lastMouseY = event.clientY;
			if (event.button === 0 && this.pointerLock && this.domElement.requestPointerLock) {
				try { this.domElement.requestPointerLock()?.catch?.(() => {}); } catch (_) { /* Drag remains available. */ }
			}
		}

		this.inputReceivers.forEach(receiver => {
			receiver.handleMouseButton(event, 'mouse' + event.button, true);
		});
	}

	public onMouseMove(event: MouseEvent): void
	{
		if (this.world.sceneEditor?.active) return;
		if (this.isLocked || this.dragging || globalThis.isMobile) {
			const dx = this.isLocked || globalThis.isMobile ? event.movementX : event.clientX - this.lastMouseX;
			const dy = this.isLocked || globalThis.isMobile ? event.movementY : event.clientY - this.lastMouseY;
			this.lastMouseX = event.clientX; this.lastMouseY = event.clientY;
			this.inputReceivers.forEach(receiver => {
				receiver.handleMouseMove(event, dx, dy);
			});
		}
	}

	public onMouseUp(event: MouseEvent): void
	{
		this.heldMouseButtons.delete(event.button);
		this.dragging = this.heldMouseButtons.size > 0;
		if (this.world.sceneEditor?.active) return;

		this.inputReceivers.forEach(receiver => {
			receiver.handleMouseButton(event, 'mouse' + event.button, false);
		});
	}

	public onKeyDown(event: KeyboardEvent): void
	{
		if (this.ignoreInput(event)) return;
		this.heldKeys.add(event.code);
		if (/^(Key[WASDFVX]|Space|Arrow(Left|Right|Up|Down))$/.test(event.code)) event.preventDefault();
		this.inputReceivers.forEach(receiver => {
			receiver.handleKeyboardEvent(event, event.code, true);
		});
	}

	public onKeyUp(event: KeyboardEvent): void
	{
		this.heldKeys.delete(event.code);
		if (this.world.sceneEditor?.active) return;
		this.inputReceivers.forEach(receiver => {
			receiver.handleKeyboardEvent(event, event.code, false);
		});
	}

	public onMouseWheelMove(event: WheelEvent): void
	{
		if (this.ignoreInput(event)) return;
		this.inputReceivers.forEach(receiver => {
			receiver.handleMouseWheel(event, event.deltaY);
		});
	}

    public releaseInput(): void {
        this.dragging = false;
        this.heldMouseButtons.clear();
        // A lost focus/editor transition must also release shooting and aiming.
        for (const code of ['mouse0', 'mouse2']) this.inputReceivers.forEach(receiver => receiver.handleMouseButton(new MouseEvent('mouseup'), code, false));
		for (const code of this.heldKeys) this.inputReceivers.forEach(receiver => receiver.handleKeyboardEvent(new KeyboardEvent('keyup', { code }), code, false));
		this.heldKeys.clear();
	}

	private ignoreInput(event: Event): boolean {
		return !!this.world.sceneEditor?.active || (event.target instanceof HTMLElement &&
			!!event.target.closest('input, textarea, select, button, dialog, [contenteditable="true"], .editor-toolbar, .editor-panel'));
	}
}
