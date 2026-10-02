
import * as CANNON from 'cannon-es';

import { Vehicle } from './Vehicle';
import { IControllable } from '../interfaces/IControllable';
import { KeyBinding } from '../core/KeyBinding';
import * as THREE from 'three';
import * as Utils from '../core/FunctionLibrary';
import { SpringSimulator } from '../physics/spring_simulation/SpringSimulator';
import { World } from '../world/World';
import { EntityType } from '../enums/EntityType';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { Car } from './Car';
import { Wheel } from './Wheel';
import { VehicleSeat } from './VehicleSeat';
import { VehicleDoor } from './VehicleDoor';
import { SeatType } from '../enums/SeatType';
import { CollisionGroups } from '../enums/CollisionGroups';

export class MyCar extends Car {
    constructor(gltf: GLTF) {
        super(gltf);
    }

    public override readVehicleData(gltf: GLTF): boolean {
        this.initCar(gltf.scene,0);
        return true;
    } 

    private initCar(carmodel: THREE.Object3D, h: number = 0.45): void {
        // Set up wheels
        //IMPORTANT: Replace with wheel objects from model
        this.wheels = [];
        const wheelPositions = [
            [0.53, -0.12 + h, 0.86],
            [0.53, -0.12 + h, -0.79],
            [-0.53, -0.12 + h, 0.86],
            [-0.53, -0.12 + h, -0.79]
        ] as const;

        for (let i = 0; i < 4; i++) {
            const wheelObject = new THREE.Object3D();
            wheelObject.position.set(wheelPositions[i][0], wheelPositions[i][1], wheelPositions[i][2]);
            this.add(wheelObject);
            this.wheels.push(new Wheel(wheelObject));
        }

        // Set wheel properties
        this.wheels[0].steering = true;
        this.wheels[0].drive = 'fwd';
        this.wheels[1].drive = 'rwd';
        this.wheels[2].steering = true;
        this.wheels[2].drive = 'fwd';
        this.wheels[3].drive = 'rwd';

        // Set up seats
        this.seats = [];
        const seatPositions = [
            [0.25, 0.06 + h, 0.09],
            [-0.25, 0.06 + h, 0.09],
            [0.25, 0.06 + h, -0.45],
            [-0.25, 0.06 + h, -0.45]
        ] as const;

        // Set up entry points
        const entryPointPositions = [
            [1.00, -0.36 + h, -0.03],
            [-1.00, -0.36 + h, -0.03],
            [1.00, -0.36 + h, -0.60],
            [-1.00, -0.36 + h, -0.60]
        ] as const;

        for (let i = 0; i < 4; i++) {
            const seatObject = new THREE.Object3D();
            seatObject.position.set(seatPositions[i][0], seatPositions[i][1], seatPositions[i][2]);
            this.add(seatObject);

            const entryPoint = new THREE.Object3D();
            entryPoint.position.set(entryPointPositions[i][0], entryPointPositions[i][1], entryPointPositions[i][2]);
            this.add(entryPoint);

            const seat = new VehicleSeat(this, seatObject, carmodel);
            seat.entryPoints.push(entryPoint);
            this.seats.push(seat);
        }

        // Set up doors
        //IMPORTANT: Replace with door objects from model
        const doorPositions = [
            [0.57, 0.13 + h, 0.21],
            [-0.57, 0.13 + h, 0.21],
            [0.57, 0.13 + h, -0.43],
            [-0.57, 0.13 + h, -0.43]
        ] as const;

        for (let i = 0; i < 4; i++) {
            const doorObject = new THREE.Object3D();
            doorObject.position.set(doorPositions[i][0], doorPositions[i][1], doorPositions[i][2]);
            this.add(doorObject);
            this.seats[i].door = new VehicleDoor(this.seats[i], doorObject);
        }

        // Connect seats
        this.seats[0].connectedSeats = [this.seats[1]];
        this.seats[1].connectedSeats = [this.seats[0]];
        this.seats[2].connectedSeats = [this.seats[3]];
        this.seats[3].connectedSeats = [this.seats[2]];
        this.seats[0].type = SeatType.Driver;
        this.seats[1].type = SeatType.Passenger;
        this.seats[2].type = SeatType.Passenger;
        this.seats[3].type = SeatType.Passenger;

        // Set up camera
        this.camera = new THREE.Object3D();
        this.camera.position.set(0.24, 0.52 + h, -0.01);
        this.add(this.camera);

        // Set up collision
        const bodyShape = new CANNON.Box(new CANNON.Vec3(0.64, 0.53, 1.245));
        bodyShape.collisionFilterMask = ~CollisionGroups.TrimeshColliders;
        this.collision.addShape(bodyShape, new CANNON.Vec3(0, 0.37 + h, 0.04));

        const lowerBodyShape = new CANNON.Box(new CANNON.Vec3(0.61, 0.25, 1.21));
        this.collision.addShape(lowerBodyShape, new CANNON.Vec3(0, 0.09 + h, 0.04));

        const cabinShape = new CANNON.Box(new CANNON.Vec3(0.54, 0.28, 0.535));
        this.collision.addShape(cabinShape, new CANNON.Vec3(0, 0.62 + h, -0.26));

        const wheelShape = new CANNON.Cylinder(0.235, 0.235, 0.15, 32);
        for (let i = 0; i < 4; i++) {
            this.collision.addShape(wheelShape, new CANNON.Vec3(...wheelPositions[i]));
        }

        // Set up materials
        this.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                Utils.setupMeshProperties(child);

                if (child.material !== undefined) {
                    this.materials.push(child.material);
                }
            }
        });
    }
}