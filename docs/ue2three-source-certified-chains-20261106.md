# Source-certified Blueprint chain conversions — 6 November 2026

Original replay: **555 → 565 / 1,957**, 276 packages; zero regressions, source mismatches or disappeared exports. Full Python suite and 241 JavaScript tests passed. New UI/strafe chains were also executed from original-source IR fixtures. Typed widget effects require explicit source bindings; game UI visual/Play parity has not been validated.

- /Game/Fixers/Core/Blueprints/Characters/CBP_Fixers_Mover_ABP :: Get_StrafeWarpDirection (export 1191)
- /Game/Fixers/UI/HUD/WBP_TeammateDot :: SetDotColor (export 9)
- /Game/Fixers/UI/InventoryV2/WBP_InventoryScreen_V2 :: SplitSelectedStack (export 138)
- /Game/Fixers/UI/QuickSlots/WBP_QuickSlots_Fixers :: RefreshAllSlots (export 17)
- /Game/Fixers/UI/QuickSlots/WBP_QuickSlots_Fixers :: RefreshSlot_Down (export 18)
- /Game/Fixers/UI/QuickSlots/WBP_QuickSlots_Fixers :: RefreshSlot_Left (export 19)
- /Game/Fixers/UI/QuickSlots/WBP_QuickSlots_Fixers :: RefreshSlot_Right (export 20)
- /Game/Fixers/UI/QuickSlots/WBP_QuickSlots_Fixers :: RefreshSlot_Up (export 21)
- /Game/Fixers/VFX/NiagaraExamples/Gallery/Widgets/WB_Crosshair :: ExecuteUbergraph_WB_Crosshair (export 15)
- /Game/Fixers/VFX/NiagaraExamples/Gallery/Widgets/WB_Crosshair :: OnInitialized (export 17)
