import unittest

from controls_migration import Package, _event_entry_points, _input_bindings, _source_input_functions


def prop(name, value):
    return {"Name": name, "Value": value}


class ControlMigrationTests(unittest.TestCase):
    def test_input_mappings_resolve_source_action_and_modifiers(self):
        package = Package({
            "Imports": [
                {"ObjectName": "InputModifierNegate"},
                {"ObjectName": "IA_Move"},
            ],
            "Exports": [{
                "ObjectName": "IMC_Fixers",
                "Data": [prop("DefaultKeyMappings", {"Mappings": [
                    {"Key": {"KeyName": "W"}, "Action": -2, "Modifiers": [-1]},
                    {"Key": {"KeyName": "D"}, "Action": -2, "Modifiers": []},
                ]})],
            }],
        })
        self.assertEqual(_input_bindings(package), [
            {"key": "W", "action": "IA_Move", "modifiers": ["InputModifierNegate"]},
            {"key": "D", "action": "IA_Move", "modifiers": []},
        ])

    def test_input_events_keep_the_compiled_ubergraph_entry_points(self):
        package = Package({"Imports": [], "Exports": [
            {"ObjectName": "ExecuteUbergraph_CBP_Fixers_Mover"},
            {"ObjectName": "InpActEvt_IA_Fire_K2Node_EnhancedInputActionEvent_14",
             "ScriptBytecode": [{
                 "$type": "UAssetAPI.Kismet.Bytecode.Expressions.EX_LocalFinalFunction, UAssetAPI",
                 "StackNode": 1,
                 "Parameters": [{"$type": "UAssetAPI.Kismet.Bytecode.Expressions.EX_IntConst, UAssetAPI", "Value": 28983}],
             }]},
        ]})
        self.assertEqual(_event_entry_points(package), [{
            "action": "IA_Fire",
            "function": "InpActEvt_IA_Fire_K2Node_EnhancedInputActionEvent_14",
            "ubergraph_entry_point": 28983,
        }])

    def test_input_function_calls_are_reported_from_compiled_blueprint(self):
        package = Package({"Imports": [{"ObjectName": "K2_AddDataToCollection"}], "Exports": [
            {"ObjectName": "ProduceInput", "ScriptBytecode": [
                {"$type": "UAssetAPI.Kismet.Bytecode.Expressions.EX_LocalVirtualFunction, UAssetAPI",
                 "VirtualFunctionName": "Get_MoveInput"},
                {"$type": "UAssetAPI.Kismet.Bytecode.Expressions.EX_FinalFunction, UAssetAPI",
                 "StackNode": -1},
            ]},
            {"ObjectName": "Unrelated", "ScriptBytecode": []},
        ]})
        self.assertEqual(_source_input_functions(package), {
            "ProduceInput": ["Get_MoveInput", "K2_AddDataToCollection"],
        })


if __name__ == "__main__":
    unittest.main()
