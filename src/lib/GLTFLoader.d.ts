import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader';


export interface GLTF {
    animations: THREE.AnimationClip[];
    scene: THREE.Group;
    scenes: THREE.Group[];
    cameras: THREE.Camera[];
    asset: {
        copyright?: string | undefined;
        generator?: string | undefined;
        version?: string | undefined;
        minVersion?: string | undefined;
        extensions?: any;
        extras?: any;
    };
    parser: GLTFParser;
    userData: any;
}

export class GLTFLoader extends THREE.Loader {
    constructor(manager?: THREE.LoadingManager);
    dracoLoader: DRACOLoader | null;

    load(
        url: string,
        onLoad: (gltf: GLTF) => void,
        onProgress?: (event: ProgressEvent) => void,
        onError?: (event: ErrorEvent) => void,
    ): void;
    loadAsync(url: string, onProgress?: (event: ProgressEvent) => void): Promise<GLTF>;

    setDRACOLoader(dracoLoader: DRACOLoader): GLTFLoader;

    register(callback: (parser: GLTFParser) => GLTFLoaderPlugin): GLTFLoader;
    unregister(callback: (parser: GLTFParser) => GLTFLoaderPlugin): GLTFLoader;

    setKTX2Loader(ktx2Loader: KTX2Loader): GLTFLoader;
    setMeshoptDecoder(meshoptDecoder: /* MeshoptDecoder */ any): GLTFLoader;

    parse(
        data: ArrayBuffer | string,
        path: string,
        onLoad: (gltf: GLTF) => void,
        onError?: (event: ErrorEvent) => void,
    ): void;

    parseAsync(data: ArrayBuffer | string, path: string): Promise<GLTF>;
}

export type GLTFReferenceType = 'materials' | 'nodes' | 'textures' | 'meshes';

export interface GLTFReference {
    materials?: number;
    nodes?: number;
    textures?: number;
    meshes?: number;
}

export class GLTFParser {
    json: any;

    options: {
        path: string;
        manager: THREE.LoadingManager;
        ktx2Loader: KTX2Loader;
        meshoptDecoder: /* MeshoptDecoder */ any;
        crossOrigin: string;
        requestHeader: { [header: string]: string };
    };

    fileLoader: THREE.FileLoader;
    textureLoader: THREE.TextureLoader | THREE.ImageBitmapLoader;
    plugins: { [name: string]: GLTFLoaderPlugin };
    extensions: { [name: string]: any };
    associations: Map<THREE.Object3D | THREE.Material | THREE.Texture, GLTFReference>;

    setExtensions(extensions: { [name: string]: any }): void;
    setPlugins(plugins: { [name: string]: GLTFLoaderPlugin }): void;

    parse(onLoad: (gltf: GLTF) => void, onError?: (event: ErrorEvent) => void): void;

    getDependency: (type: string, index: number) => Promise<any>;
    getDependencies: (type: string) => Promise<any[]>;
    loadBuffer: (bufferIndex: number) => Promise<ArrayBuffer>;
    loadBufferView: (bufferViewIndex: number) => Promise<ArrayBuffer>;
    loadAccessor: (accessorIndex: number) => Promise<THREE.BufferAttribute | THREE.InterleavedBufferAttribute>;
    loadTexture: (textureIndex: number) => Promise<THREE.Texture>;
    loadTextureImage: (textureIndex: number, sourceIndex: number, loader: THREE.Loader) => Promise<THREE.Texture>;
    loadImageSource: (sourceIndex: number, loader: THREE.Loader) => Promise<THREE.Texture>;
    assignTexture: (
        materialParams: { [key: string]: any },
        mapName: string,
        mapDef: {
            index: number;
            texCoord?: number | undefined;
            extensions?: any;
        },
    ) => Promise<void>;
    assignFinalMaterial: (object: THREE.Mesh) => void;
    getMaterialType: () => typeof THREE.MeshStandardMaterial;
    loadMaterial: (materialIndex: number) => Promise<THREE.Material>;
    createUniqueName: (originalName: string) => string;
    createNodeMesh: (nodeIndex: number) => Promise<THREE.Group | THREE.Mesh | THREE.SkinnedMesh>;
    loadGeometries: (
        /**
         * GLTF.Primitive[]
         * See: https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/schema/mesh.primitive.schema.json
         */
        primitives: Array<{ [key: string]: any }>,
    ) => Promise<THREE.BufferGeometry[]>;
    loadMesh: (meshIndex: number) => Promise<THREE.Group | THREE.Mesh | THREE.SkinnedMesh>;
    loadCamera: (cameraIndex: number) => Promise<THREE.Camera>;
    loadSkin: (skinIndex: number) => Promise<{
        joints: number[];
        inverseBindMatrices?: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    }>;
    loadAnimation: (animationIndex: number) => Promise<THREE.AnimationClip>;
    loadNode: (nodeIndex: number) => Promise<THREE.Object3D>;
    loadScene: () => Promise<THREE.Group>;
}

export interface GLTFLoaderPlugin {
    beforeRoot?: (() => Promise<void> | null) | undefined;
    afterRoot?: ((result: GLTF) => Promise<void> | null) | undefined;
    loadMesh?: ((meshIndex: number) => Promise<THREE.Group | THREE.Mesh | THREE.SkinnedMesh> | null) | undefined;
    loadBufferView?: ((bufferViewIndex: number) => Promise<ArrayBuffer> | null) | undefined;
    loadMaterial?: ((materialIndex: number) => Promise<THREE.Material> | null) | undefined;
    loadTexture?: ((textureIndex: number) => Promise<THREE.Texture> | null) | undefined;
    getMaterialType?: ((materialIndex: number) => typeof THREE.Material | null) | undefined;
    extendMaterialParams?:
        | ((materialIndex: number, materialParams: { [key: string]: any }) => Promise<any> | null)
        | undefined;
    createNodeMesh?: ((nodeIndex: number) => Promise<THREE.Group | THREE.Mesh | THREE.SkinnedMesh> | null) | undefined;
    createNodeAttachment?: ((nodeIndex: number) => Promise<THREE.Object3D> | null) | undefined;
}
