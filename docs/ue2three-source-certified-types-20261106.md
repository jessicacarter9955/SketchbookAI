# Source-certified Blueprint chain conversions — 6 November 2026

Original replay: **565 → 575 / 1,957**, 276 packages; zero regressions, source mismatches or disappeared exports. Full Python suite and 243 JavaScript tests passed. New UI/strafe chains were also executed from original-source IR fixtures. Typed widget effects require explicit source bindings; game UI visual/Play parity has not been validated.

- /Game/Blueprints/BPI_SandboxCharacter_Pawn :: Get_PropertiesForTraversal (export 10)
- /Game/Blueprints/BPI_SandboxCharacter_Pawn :: Get_PropertiesForAnimation (export 8)
- /Game/Blueprints/BPI_SandboxCharacter_Pawn :: Get_PropertiesForCamera (export 9)
- /Game/Blueprints/SmartObjects/AC_SmartObjectAnimation :: OnNotifyBegin_3842BE40445726A60460DAA8B53487C2 (export 35)
- /Game/Fixers/Core/Blueprints/Characters/CBP_Fixers_Mover_ABP :: EvaluateGraphExposedInputs_ExecuteUbergraph_CBP_Fixers_Mover_ABP_AnimGraphNode_ControlRig_3C9ABB30429E4227171419BA20E2D1F5 (export 1064)
- /Game/Fixers/Core/Blueprints/Characters/CBP_Fixers_Mover_ABP :: Get_LandVelocity (export 1176)
- /Game/Fixers/Core/Blueprints/Characters/CBP_Fixers_Mover_ABP :: Get_SlideSlopeOffset (export 1188)
- /Game/Fixers/Core/Game/GameInstance/BP_GI_Fixers :: GetSavedQuests (export 36)
- /Game/Fixers/Core/Game/GameInstance/BP_GI_Fixers :: SaveQuests (export 56)
- /Game/Fixers/Core/Game/PlayerState_BPS/BPS_Fixers :: HasActiveQuestFromFixer (export 12)
