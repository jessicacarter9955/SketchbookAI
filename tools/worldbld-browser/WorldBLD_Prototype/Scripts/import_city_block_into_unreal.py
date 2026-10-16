"""Run inside a legitimately installed UE5.8 editor with WorldBLD and StreetMap enabled.

Imports our actual OSM city-block asset via the plugin importer; places a
StreetMapActor. RoadBLD/CityBLD conversion is a distinct licensed editor step.
NEVER claim running this script is equal to native CityBLD generation.
"""
import os
import json
import unreal

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OSM = os.path.normpath(os.path.join(PROJECT,"..","worldbld-city-block.osm"))
DESTINATION = "/Game/WorldBLDBlock"
ENGINE_VERSION = unreal.SystemLibrary.get_engine_version()
print("WorldBLD bootstrap engine:", ENGINE_VERSION)
assert os.path.exists(OSM), "Missing canonical OSM: "+OSM

# This is a hard dependency because WorldBLD docs use UE StreetMap for OSM import.
assert hasattr(unreal,"StreetMap"), "StreetMap plugin missing: enable official StreetMap importer and restart Unreal Editor"
assert hasattr(unreal,"StreetMapActor"), "StreetMapActor missing: StreetMapRuntime module has not loaded"

asset_tools=unreal.AssetToolsHelpers.get_asset_tools()
task=unreal.AssetImportTask()
task.set_editor_property("filename", OSM)
task.set_editor_property("destination_path", DESTINATION)
task.set_editor_property("destination_name", "WorldBLD_Block_StreetMap")
task.set_editor_property("automated",True)
task.set_editor_property("replace_existing",True)
task.set_editor_property("save",True)
asset_tools.import_asset_tasks([task])
paths=[str(p) for p in task.get_editor_property("imported_object_paths")]
assert paths, "StreetMap importer returned no assets"
imported=unreal.load_asset(paths[0])
assert imported, "Cannot load imported StreetMap object: "+paths[0]
if "StreetMap" not in imported.get_class().get_name():
    raise RuntimeError("Unexpected import asset class: "+imported.get_class().get_name())

actors=unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
scene_actor=actors.spawn_actor_from_class(unreal.StreetMapActor,unreal.Vector(0,0,0),unreal.Rotator(0,0,0))
assert scene_actor,"Cannot spawn StreetMapActor"
scene_actor.set_actor_label("WorldBLD_Block_Imported_OSM")
street_component=scene_actor.get_component_by_class(unreal.StreetMapComponent)
assert street_component,"StreetMapActor missing StreetMapComponent"
street_component.set_street_map(imported,False,True)
unreal.EditorAssetLibrary.save_directory(DESTINATION,only_if_is_dirty=False,recursive=True)

# Saving the level requires a writable open editor map, and may fail in a
# commandlet-only context. Fail clearly rather than pretending it's persisted.
if not unreal.EditorLevelLibrary.save_current_level():
    raise RuntimeError("Current level save failed - do not treat scene as persisted")

result={
 "engine_version":ENGINE_VERSION,
 "streetmap_asset":paths[0],
 "streetmap_actor":scene_actor.get_actor_label(),
 "native_worldbld_roadblD_conversion_complete":False,
 "native_cityblD_blocks_complete":False,
 "editor_map_saved":True,
}
print("WORLD_BLD_IMPORT_RESULT="+json.dumps(result,sort_keys=True))
