import '../css/main.css';
import { SceneEditor } from '../editor/SceneEditor';
globalThis.SceneEditor = SceneEditor;
import { CityRuntime } from '../editor/CityRuntime';
import { ActorLayer } from '../editor/ActorLayer';
globalThis.CityRuntime = CityRuntime;
globalThis.ActorLayer = ActorLayer;
import * as THREEImport from 'three';
import * as CANNONImport from 'cannon-es';

import { FollowTarget } from './characters/character_ai/FollowTarget';
import { FollowPath } from './characters/character_ai/FollowPath';
import { RandomBehaviour } from './characters/character_ai/RandomBehaviour';
globalThis.CharacterAI = {
    FollowTarget,
    FollowPath,
    RandomBehaviour,
};
globalThis.FollowTarget = FollowTarget;
globalThis.FollowPath = FollowPath;
globalThis.RandomBehaviour = RandomBehaviour;
globalThis.gui = globalThis.dat?.GUI?.prototype;


import {Car} from './vehicles/Car';
globalThis.Car = Car;
import {MyCar} from './vehicles/MyCar';
globalThis.MyCar = MyCar;
import {Helicopter} from './vehicles/Helicopter';
globalThis.Helicopter = Helicopter;
import {Vehicle} from './vehicles/Vehicle';
globalThis.Vehicle = Vehicle;
import {Airplane} from './vehicles/Airplane';
globalThis.Airplane = Airplane;


import {Wheel} from './vehicles/Wheel';
globalThis.Wheel = Wheel;
import {VehicleSeat} from './vehicles/VehicleSeat';
globalThis.VehicleSeat = VehicleSeat;
import {SeatType} from './enums/SeatType';
globalThis.SeatType = SeatType;
import {VehicleDoor} from './vehicles/VehicleDoor';
globalThis.VehicleDoor = VehicleDoor;

import * as statesLibrary from './characters/character_states/_stateLibrary';
globalThis.CharacterStates = statesLibrary;

import { Character } from './characters/Character';
globalThis.Character = Character;
import { KeyBinding } from './core/KeyBinding';
globalThis.KeyBinding = KeyBinding;
globalThis.THREE = THREEImport;
globalThis.CANNON = CANNONImport;    

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
globalThis.GLTFLoader = GLTFLoader;
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
globalThis.OrbitControls = OrbitControls;

import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
globalThis.FBXLoader = FBXLoader;
import { LoadingManager } from './core/LoadingManager';
globalThis.LoadingManager = LoadingManager;

import { World } from './world/World';
globalThis.World = World;
import { BoxCollider } from './physics/colliders/BoxCollider';
globalThis.BoxCollider = BoxCollider;
import { SphereCollider } from './physics/colliders/SphereCollider';
globalThis.SphereCollider = SphereCollider;
import { TrimeshCollider } from './physics/colliders/TrimeshCollider';
globalThis.TrimeshCollider = TrimeshCollider;

import * as Utils from './core/FunctionLibrary';
globalThis.Utils = Utils;

import { EntityType } from './enums/EntityType';
globalThis.EntityType = EntityType;

import { CollisionGroups } from './enums/CollisionGroups';
globalThis.CollisionGroups = CollisionGroups;

import { VectorSpringSimulator } from './physics/spring_simulation/VectorSpringSimulator';
globalThis.VectorSpringSimulator = VectorSpringSimulator;





import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils';
globalThis.SkeletonUtils = SkeletonUtils;


import Swal from 'sweetalert2';
import * as datGui from '../lib/utils/dat.gui';
globalThis.Swal = Swal.mixin({
    toast: true,
    onOpen: (toast) => {
        if (!toast.classList.contains('swal2-toast')) {
            document.exitPointerLock();
        }
    }
});


