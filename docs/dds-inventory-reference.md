# DDS inventory reference

The browser inventory follows the available Unreal Inventory V2 **structure**. Its exact appearance has not been verified against a running Unreal viewport, so it is not a pixel-identical reproduction.

The local asset inventory, `.local/unreal-export/inventory.json`, lists `WBP_InventoryScreen_V2`, `WBP_CarrySlot_V2`, `WBP_EquipmentSlot_V2`, `WBP_WeaponSlot_V2`, `WBP_InventoryTab_V2`, `WBP_ItemTooltip_V2`, `WBP_ControlHints_V2`, and `WBP_ModSlot_V2` in `/Game/Fixers/UI/InventoryV2`.

An ASCII name inspection of the locally supplied `Content/Fixers/UI/InventoryV2/WBP_InventoryScreen_V2.uasset` found these relevant names:

| Unreal names | Browser implementation |
| --- | --- |
| `WeaponSlot_Primary`, `WeaponSlot_Secondary` | Separate primary and secondary weapon cards, active weapon indicator, equip and holster actions. |
| `EquipSlot_Armor`, `EquipSlot_Backpack`, `EquipSlot_Shield` | Marked unavailable because the browser game does not implement these equipment systems. |
| `CarryGrid`, `CarryGridColumns`, `UniformGridPanel_Carry`, `GetCarryCapacity` | Responsive carry grid, actual ammo/medical/quest stacks, capacity and empty cells. |
| `GetCurrentWeight`, `GetMaxWeight`, `Text_WeightCount` | Weight and limit read directly from game state. |
| `GetCurrency`, `HBox_Currency` | Actual saved credits. |
| `WBP_ItemTooltip_V2`, `ShowTooltip`, `HideTooltip` | Persistent selected-item details with relevant actions. |
| `Stash`, `StashCapacity`, `RefreshStashPanel`, `Server_TransferToStash` | Deposit tab explicitly unavailable. No transfer controls are presented. |

`DdsInventory` is presentation-only: it calls `game.equip(id)`, `game.equip(null)`, and `game.heal()`. The UI never mutates inventory state. Its native dialog exposes `element`, `dialog`, `isOpen`, `open()`, `close()`, `toggle()`, `render()` and `destroy()`. Opening and closing clear active controls; closing invokes the supplied `onclose` callback, or `game.focus()` by default.

`DdsInteractionPanel` displays guide dialogue and merchant offers. It reads the shared `SHOP_OFFERS` definitions and sends purchases to `game.buy(id)`, then shows the returned result. It exposes `element`, `dialog`, `isOpen`, `open(npc)`, `close()`, `render()` and `destroy()`. The guide responds to topic buttons and displays live mission progress.

All SVG line illustrations and browser styling were authored for this implementation. No proprietary Unreal UI textures, icons or binary assets are included in these modules. Drag-and-drop, equipment modifications and stash transfers are not implemented.
