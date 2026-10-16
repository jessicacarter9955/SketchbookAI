import copy
import unittest
from blueprint_migration import BlueprintTranslationError
from blueprint_types import source_structs
from blueprint_values import source_tables


class SourceValueTests(unittest.TestCase):
    def documents(self):
        imports = [{'ObjectName': 'Texture2D', 'OuterIndex': -2}, {'ObjectName': '/Script/Engine', 'ClassName': 'Package'},
                   {'ObjectName': 'Icon', 'OuterIndex': -4}, {'ObjectName': '/Game/Icon', 'ClassName': 'Package'},
                   {'ObjectName': 'Vector', 'OuterIndex': -6}, {'ObjectName': '/Script/CoreUObject', 'ClassName': 'Package'},
                   {'ObjectName': 'Row', 'OuterIndex': -8}, {'ObjectName': '/Game/Row', 'ClassName': 'Package'}]
        props = [{'Name': 'Names', 'SerializedType': 'ArrayProperty', 'Inner': {'SerializedType': 'NameProperty'}},
                 {'Name': 'Title', 'SerializedType': 'TextProperty'},
                 {'Name': 'Icon', 'SerializedType': 'ObjectProperty', 'PropertyClass': -1},
                 {'Name': 'Offset', 'SerializedType': 'StructProperty', 'Struct': -5},
                 {'Name': 'Weight', 'SerializedType': 'DoubleProperty'}]
        values = [{'Name': 'Names', 'Value': []}, {'Name': 'Title', 'HistoryType': 'None', 'Value': None},
                  {'Name': 'Icon', 'Value': -3}, {'Name': 'Offset', 'Value': [{'Value': {'X': '+0', 'Y': 2, 'Z': -1}}]},
                  {'Name': 'Weight', 'Value': 0.25}]
        return {'/Game/Row': {'Imports': imports, 'Exports': [{'ObjectName': 'Row', 'LoadedProperties': props, 'StructData': values}]}}, imports

    def table(self):
        docs, imports = self.documents()
        docs['/Game/Table'] = {'Imports': imports, 'Exports': [{'ObjectName': 'Table',
            'Data': [{'Name': 'RowStruct', 'Value': -7}], 'Table': {'Data': [{'Name': 'First', 'Value': [
                {'Name': 'Title', 'HistoryType': 'Base', 'Flags': 0, 'Namespace': 'NS', 'Value': 'Key', 'CultureInvariantString': 'Source text'},
                {'Name': 'Names', 'Value': [{'Value': 'Mod_A'}]}]}]}}]}
        return docs

    def test_sparse_rows_copy_original_defaults_text_identity_and_asset_references(self):
        docs = self.table(); structs = source_structs(docs, BlueprintTranslationError)
        tables, blocked = source_tables(docs, structs)
        self.assertEqual(blocked, {})
        row = tables['/Game/Table.Table']['rows']['First']
        self.assertEqual(row['Weight'], 0.25)
        self.assertEqual(row['Offset'], {'X': 0, 'Y': 2, 'Z': -1})
        self.assertEqual(row['Icon'], {'asset': '/Game/Icon.Icon', 'declared_class': ['/Script/Engine', 'Texture2D']})
        self.assertEqual(row['Title'], {'history': 'base', 'text': 'Source text', 'namespace': 'NS', 'key': 'Key', 'flags': 0})
        self.assertEqual(row['Names'], ['Mod_A'])
        row['Offset']['X'] = 9
        self.assertEqual(structs[('/Game/Row', 'Row')]['default']['Offset']['X'], 0)

    def test_unknown_text_history_blocks_the_whole_table(self):
        docs = self.table(); docs['/Game/Table']['Exports'][0]['Table']['Data'][0]['Value'][0]['HistoryType'] = 'StringTableEntry'
        tables, blocked = source_tables(docs, source_structs(docs, BlueprintTranslationError))
        self.assertEqual(tables, {}); self.assertIn('/Game/Table', blocked)

    def test_missing_type_unknown_field_and_case_duplicate_rows_never_succeed_partially(self):
        for mode in ('type', 'field', 'duplicate'):
            docs = self.table(); rows = docs['/Game/Table']['Exports'][0]['Table']['Data']
            if mode == 'type': del docs['/Game/Row']
            elif mode == 'field': rows[0]['Value'].append({'Name': 'Unknown', 'Value': 1})
            else: rows.append({**copy.deepcopy(rows[0]), 'Name': 'FIRST'})
            tables, blocked = source_tables(docs, source_structs(docs, BlueprintTranslationError))
            self.assertEqual(tables, {}); self.assertIn('/Game/Table', blocked)

    def test_unresolved_object_or_nonfinite_native_default_blocks_constructor(self):
        for mode in ('object', 'number'):
            docs, _ = self.documents(); values = docs['/Game/Row']['Exports'][0]['StructData']
            if mode == 'object': values[2]['Value'] = 1
            else: values[3]['Value'][0]['Value']['X'] = 'nan'
            self.assertEqual(source_structs(docs, BlueprintTranslationError), {})
