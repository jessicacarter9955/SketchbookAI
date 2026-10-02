export declare class KeyBinding {
    eventCodes: string[];
    isPressed: boolean;
    justPressed: boolean;
    justReleased: boolean;
    static CreateKeyBinding(code: string): KeyBinding;
    static CreateMouseBinding(code: number): KeyBinding;
    constructor(...code: string[]);
}
