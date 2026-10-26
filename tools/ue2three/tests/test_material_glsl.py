"""Contract tests for source-witnessed Unreal material GLSL lowering."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from material_glsl import Compiler, MaterialGLSLError, compile_graph


def node(i, kind, inputs=None, props=None):
    return {'index': i, 'class': 'MaterialExpression' + kind,
            'inputs': inputs or {}, 'properties': props or {}}


def link(i, mask=None, output=0):
    return {'expression': i, 'output': output, 'mask': mask or [0, 0, 0, 0, 0]}


def graph(nodes, roots):
    return {'schema_version': 1, 'status': 'direct_connections_recovered',
            'nodes': nodes, 'roots': roots}


class SourceMaterialShaderTests(unittest.TestCase):
    def test_original_constant_color_and_roughness(self):
        nodes = [node(1, 'Constant3Vector', props={'Constant': {
                    'Constant': {'R': 0.2, 'G': 0.4, 'B': 0.6, 'A': 1}}}),
                 node(2, 'Constant', props={'R': 0.35})]
        result = compile_graph(graph(nodes, {'BaseColor': link(1), 'Roughness': link(2)}))
        self.assertEqual(result['translated_roots']['BaseColor']['glsl'],
                         'vec3(0.2, 0.4, 0.6)')
        self.assertEqual(result['translated_roots']['Roughness']['glsl'], '0.35')
        self.assertEqual(result['blocked_roots'], {})
        self.assertEqual(result['shader_execution'], 'not_integrated')

    def test_scalar_splat_and_parameter_source_name(self):
        nodes = [node(1, 'ScalarParameter', props={
                    'ParameterName': 'Roughness', 'DefaultValue': 0.7}),
                 node(2, 'Constant3Vector', props={'Constant': {
                    'R': 1, 'G': 0.3, 'B': 0.4, 'A': 1}}),
                 node(3, 'Multiply', inputs={'A': link(1), 'B': link(2)})]
        result = compile_graph(graph(nodes, {'BaseColor': link(3)}))
        self.assertIn('vec3(uep_1)', result['translated_roots']['BaseColor']['glsl'])
        self.assertEqual(result['uniforms']['uep_1']['source_name'], 'Roughness')
        self.assertEqual(result['uniforms']['uep_1']['default'], ['0.7'])

    def test_native_mask_and_original_rgba(self):
        nodes = [node(1, 'VectorParameter', props={
            'ParameterName': 'Paint',
            'DefaultValue': {'DefaultValue': {'R': 0.5, 'G': 0.6, 'B': 0.7, 'A': 1}}})]
        result = compile_graph(graph(nodes, {
            'BaseColor': link(1), 'Opacity': link(1, mask=[1, 0, 0, 0, 1])}))
        self.assertEqual(result['translated_roots']['BaseColor']['glsl'], '(uep_1).xyz')
        self.assertEqual(result['translated_roots']['Opacity']['glsl'], '(uep_1).w')
        self.assertEqual(result['uniforms']['uep_1']['type'], 'vec4')

    def test_unsupported_native_functions_and_textures_are_not_approximated(self):
        for kind in ('TextureSample', 'MaterialFunctionCall', 'SceneColor'):
            with self.subTest(kind=kind):
                result = compile_graph(graph([node(1, kind)], {'BaseColor': link(1)}))
                self.assertNotIn('BaseColor', result['translated_roots'])
                self.assertIn('Unsupported witnessed', result['blocked_roots']['BaseColor'])

    def test_independent_roots_and_unresolved_output_index(self):
        nodes = [node(1, 'Constant', props={'R': 0.2}), node(2, 'TextureSample')]
        result = compile_graph(graph(nodes, {
            'Roughness': link(1), 'BaseColor': link(2, output=1)}))
        self.assertEqual(result['translated_roots']['Roughness']['glsl'], '0.2')
        self.assertIn('BaseColor', result['blocked_roots'])

    def test_cycle_missing_source_export_duplicate_indices(self):
        nodes = [node(1, 'OneMinus', inputs={'Input': link(2)}),
                 node(2, 'OneMinus', inputs={'Input': link(1)})]
        result = compile_graph(graph(nodes, {'Roughness': link(1)}))
        self.assertIn('Cyclic', result['blocked_roots']['Roughness'])
        result = compile_graph(graph([], {'Roughness': link(7)}))
        self.assertIn('non-expression export', result['blocked_roots']['Roughness'])
        with self.assertRaises(MaterialGLSLError):
            Compiler(graph([node(1, 'Constant'), node(1, 'Constant')], {}))

    def test_nonfinite_values_and_unsafe_scalar_casts(self):
        nodes = [node(1, 'Constant', props={'R': float('nan')}),
                 node(2, 'Constant3Vector', props={
                     'Constant': {'R': 1, 'G': 1, 'B': 1, 'A': 1}})]
        result = compile_graph(graph(nodes, {'Roughness': link(1), 'Opacity': link(2)}))
        self.assertIn('Non-finite', result['blocked_roots']['Roughness'])
        self.assertIn('Unsafe material root', result['blocked_roots']['Opacity'])

    def test_unconnected_native_optional_pins_use_verified_cpp_defaults(self):
        nodes = [node(1, 'Multiply', inputs={'A': link(0), 'B': link(0)})]
        result = compile_graph(graph(nodes, {'Roughness': link(1)}))
        self.assertEqual(result['translated_roots']['Roughness']['glsl'], '(0.0 * 1.0)')

    def test_native_optional_defaults_and_connected_errors(self):
        for kind, expected in (('Add', '(0.0 + 1.0)'), ('Subtract', '(1.0 - 1.0)'),
                               ('Divide', '(1.0 / 2.0)'), ('LinearInterpolate', 'mix(0.0, 1.0, 0.5)')):
            result = compile_graph(graph([node(1, kind)], {'Roughness': link(1)}))
            self.assertEqual(result['translated_roots']['Roughness']['glsl'], expected)
        source = graph([node(1, 'Multiply', {'A': link(2)}, {'ConstA': 0.7}),
                        node(2, 'SceneColor')], {'Roughness': link(1)})
        self.assertIn('SceneColor', compile_graph(source)['blocked_roots']['Roughness'])

    def test_native_period_and_nonpositive_period_semantics(self):
        value = node(1, 'Constant', props={'R': 0.25})
        for kind, period, expected in (('Sine', 1, '6.28318531'), ('Cosine', 2, '3.14159265'),
                                        ('Sine', 0, '1.0'), ('Cosine', 0, '0.0')):
            source = graph([value, node(2, kind, {'Input': link(1)}, {'Period': period})],
                           {'Roughness': link(2)})
            self.assertIn(expected, compile_graph(source)['translated_roots']['Roughness']['glsl'])

    def test_append_power_and_static_source_default(self):
        nodes = [node(1, 'Constant', props={'R': 0.5}),
                 node(2, 'AppendVector', {'A': link(1), 'B': link(1)}),
                 node(3, 'Power', {'Base': link(1)}),
                 node(4, 'StaticSwitchParameter', {'A': link(999), 'B': link(3)},
                      {'ParameterName': 'OriginalSwitch'})]
        result = compile_graph(graph(nodes, {'Roughness': link(4)}))
        self.assertEqual(result['translated_roots']['Roughness']['glsl'], 'uePositiveClampedPow(0.5, 2.0)')
        self.assertEqual(Compiler(graph(nodes, {})).node(2).width, 2)
        nodes[-1]['properties']['DefaultValue'] = True
        self.assertIn('non-expression', compile_graph(graph(nodes, {'Roughness': link(4)}))['blocked_roots']['Roughness'])

    def test_failed_root_does_not_cache_uniform_without_binding(self):
        nodes = [node(1, 'ScalarParameter', props={'ParameterName': 'Original', 'DefaultValue': 0.4}),
                 node(2, 'Multiply', {'A': link(1), 'B': link(999)})]
        result = compile_graph(graph(nodes, {'BaseColor': link(2), 'Roughness': link(1)}))
        self.assertIn('BaseColor', result['blocked_roots'])
        self.assertIn('uep_1', result['uniforms'])

    def test_smoothstep_bias_scale_normalize_and_round_are_lowered(self):
        nodes = [node(1, 'Constant', props={'R': 0.25}),
                 node(2, 'SmoothStep', {'Min': link(1), 'Max': link(1), 'Value': link(1)}),
                 node(3, 'ConstantBiasScale', {'Input': link(1)}, {'Bias': 0.5, 'Scale': 2}),
                 node(4, 'Constant3Vector', props={'Constant': {'R': 1, 'G': 2, 'B': 3, 'A': 1}}),
                 node(5, 'Normalize', {'VectorInput': link(4)}),
                 node(6, 'Round', {'Input': link(1)})]
        result = compile_graph(graph(nodes, {'Roughness': link(2), 'Metallic': link(3),
                                             'EmissiveColor': link(5), 'Opacity': link(6)}))
        roots = result['translated_roots']
        self.assertEqual(roots['Roughness']['glsl'], 'smoothstep(0.25, 0.25, 0.25)')
        self.assertEqual(roots['Metallic']['glsl'], '((0.25 + 0.5) * 2.0)')
        self.assertEqual(roots['EmissiveColor']['glsl'], 'normalize(vec3(1.0, 2.0, 3.0))')
        self.assertEqual(roots['Opacity']['glsl'], 'round(0.25)')
        self.assertEqual(result['blocked_roots'], {})

    def test_power_witnesses_optional_exponent_and_retains_ue_domain_guard(self):
        source = graph([node(1, 'Power', {'Base': link(2)}, {'ConstExponent': 3}),
                        node(2, 'Constant', props={'R': 0.5})], {'Roughness': link(1)})
        lowered = compile_graph(source)['translated_roots']['Roughness']['glsl']
        self.assertIn('3.0', lowered)
        self.assertIn('uePositiveClampedPow', lowered)
        self.assertNotIn('pow(', lowered)

    def test_connected_unimplemented_vertex_root_is_explicitly_blocked(self):
        result = compile_graph(graph([node(1, 'Constant', props={'R': 1})],
                                     {'WorldPositionOffset': link(1)}))
        self.assertIn('WorldPositionOffset', result['blocked_roots'])
        self.assertEqual(result['translated_roots'], {})


    def test_original_named_reroute_resolves_by_export_and_guid(self):
        declaration = node(3, 'NamedRerouteDeclaration', inputs={'Input': link(2)},
                           props={'VariableGuid': {'VariableGuid': '{ORIGINAL-GUID}'}})
        usage = node(4, 'NamedRerouteUsage',
                     props={'Declaration': 3,
                            'DeclarationGuid': {'DeclarationGuid': '{ORIGINAL-GUID}'}})
        source = graph([node(2, 'Constant', props={'R': 0.42}), declaration, usage],
                       {'Roughness': link(4)})
        result = compile_graph(source)
        self.assertEqual(result['translated_roots']['Roughness']['glsl'], '0.42')
        self.assertEqual(result['blocked_roots'], {})
        usage['properties']['DeclarationGuid']['DeclarationGuid'] = '{DIFFERENT}'
        self.assertIn('GUID', compile_graph(source)['blocked_roots']['Roughness'])
        usage['properties']['DeclarationGuid']['DeclarationGuid'] = '{ORIGINAL-GUID}'
        usage['properties']['Declaration'] = 5
        self.assertIn('missing', compile_graph(source)['blocked_roots']['Roughness'])

    def test_source_vector_min_max_dot_and_fail_closed_widths(self):
        vec_a = node(1, 'Constant3Vector', props={
            'Constant': {'R': 0.1, 'G': 0.2, 'B': 0.3, 'A': 1}})
        vec_b = node(2, 'Constant3Vector', props={
            'Constant': {'R': 0.4, 'G': 0.5, 'B': 0.6, 'A': 1}})
        minimum = node(3, 'Min', inputs={'A': link(1), 'B': link(2)})
        maximum = node(4, 'Max', inputs={'A': link(1), 'B': link(2)})
        product = node(5, 'DotProduct', inputs={'A': link(1), 'B': link(2)})
        result = compile_graph(graph([vec_a, vec_b, minimum, maximum, product], {
            'BaseColor': link(3), 'EmissiveColor': link(4), 'Roughness': link(5)}))
        self.assertEqual(result['blocked_roots'], {})
        self.assertTrue(result['translated_roots']['BaseColor']['glsl'].startswith('min('))
        self.assertTrue(result['translated_roots']['EmissiveColor']['glsl'].startswith('max('))
        self.assertTrue(result['translated_roots']['Roughness']['glsl'].startswith('dot('))
        scalar = node(2, 'Constant', props={'R': 1})
        invalid = compile_graph(graph([vec_a, scalar, product], {'Roughness': link(5)}))
        self.assertIn('widths differ', invalid['blocked_roots']['Roughness'])


    def test_native_clamp_defaults_and_source_mode_fail_closed(self):
        x = node(1, 'Constant', props={'R': 0.65})
        cl = node(2, 'Clamp', inputs={'Input': link(1)})
        source = graph([x, cl], {'Roughness': link(2)})
        result = compile_graph(source)
        self.assertEqual(result['translated_roots']['Roughness']['glsl'],
                         'clamp(0.65, 0.0, 1.0)')
        cl['properties']['ClampMode'] = 'CMODE_ClampMin'
        result = compile_graph(source)
        self.assertIn('clamp mode', result['blocked_roots']['Roughness'])
        cl['properties']['ClampMode'] = 0
        cl['properties']['MinDefault'] = 0.2
        self.assertIn('0.2', compile_graph(source)['translated_roots']['Roughness']['glsl'])


    def test_witnessed_power_smoothstep_and_bias_scale(self):
        inputs = [node(1, 'Constant', props={'R': 0.5}),
                  node(2, 'Constant', props={'R': 2.0}),
                  node(3, 'Power', inputs={'Base': link(1), 'Exponent': link(2)}),
                  node(4, 'SmoothStep', inputs={'Min': link(1), 'Max': link(2), 'Value': link(3)}),
                  node(5, 'ConstantBiasScale', inputs={'Input': link(4)},
                       props={'Bias': -0.7, 'Scale': 2})]
        result = compile_graph(graph(inputs, {'Roughness': link(5)}))
        code = result['translated_roots']['Roughness']['glsl']
        self.assertIn('uePositiveClampedPow(0.5, 2.0)', code)
        self.assertIn('smoothstep(', code)
        self.assertIn('-0.7', code)
        self.assertEqual(result['blocked_roots'], {})

    def test_original_ceil_round_and_vector_normalize(self):
        nodes = [node(1, 'Constant', props={'R': 0.52}),
                 node(2, 'Ceil', inputs={'Input': link(1)}),
                 node(3, 'Round', inputs={'Input': link(1)}),
                 node(4, 'Constant3Vector', props={'Constant': {
                     'Constant': {'R': 0.2, 'G': 0.4, 'B': 0.6, 'A': 1}}}),
                 node(5, 'Normalize', inputs={'VectorInput': link(4)})]
        result = compile_graph(graph(nodes, {
            'Roughness': link(2), 'Metallic': link(3), 'BaseColor': link(5)}))
        self.assertEqual(result['translated_roots']['Roughness']['glsl'], 'ceil(0.52)')
        self.assertEqual(result['translated_roots']['Metallic']['glsl'], 'round(0.52)')
        self.assertIn('normalize(vec3', result['translated_roots']['BaseColor']['glsl'])
        self.assertEqual(result['blocked_roots'], {})

    def test_new_ops_fail_closed_for_unwitnessed_inputs_and_types(self):
        cases = [
            node(1, 'Power', inputs={'Exponent': link(2)}),
            node(1, 'SmoothStep', inputs={'Min': link(2), 'Max': link(2)}),
            node(1, 'Normalize', inputs={'VectorInput': link(2)}),
            node(1, 'ConstantBiasScale', inputs={'Input': link(2)}, props={'Bias': 0}),
            node(1, 'ConstantBiasScale', inputs={'Input': link(2)}, props={'Bias': 0, 'Scale': 'NaN'})]
        for tested in cases:
            with self.subTest(kind=tested['class'], props=tested['properties']):
                result = compile_graph(graph([tested, node(2, 'Constant', props={'R': 0.5})],
                                             {'Roughness': link(1)}))
                self.assertIn('Roughness', result['blocked_roots'])


if __name__ == '__main__':
    unittest.main()
