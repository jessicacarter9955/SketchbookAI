"""Lower source-witnessed Unreal Material graphs to typed GLSL expressions.

This is not a runnable/visually certified Three.js shader: lighting, native
functions, textures, instances and vertex behavior must be bound separately.
Reachable unknown operations fail closed, never turn into arbitrary defaults.
"""
from dataclasses import dataclass
import math


class MaterialGLSLError(ValueError):
    pass


@dataclass(frozen=True)
class Expr:
    code: str
    width: int


ROOTS = {'BaseColor': 3, 'EmissiveColor': 3, 'Metallic': 1, 'Roughness': 1,
         'Specular': 1, 'Opacity': 1, 'OpacityMask': 1, 'AmbientOcclusion': 1}
CHANNELS = 'xyzw'


def number(v):
    if type(v) not in (int, float, str):
        raise MaterialGLSLError('Missing or invalid numeric source value')
    try:
        n = float(v)
    except (ValueError, OverflowError):
        raise MaterialGLSLError('Invalid numeric source value') from None
    if not math.isfinite(n):
        raise MaterialGLSLError('Non-finite source material constant')
    s = format(n, '.9g')
    return s if '.' in s or 'e' in s else s + '.0'


def vector(values):
    if not 1 <= len(values) <= 4:
        raise MaterialGLSLError('Invalid source vector width')
    if len(values) == 1:
        return Expr(number(values[0]), 1)
    return Expr(f'vec{len(values)}({", ".join(number(v) for v in values)})', len(values))


def color(props, key):
    value = props.get(key)
    if isinstance(value, dict) and key in value:
        value = value[key]
    if not isinstance(value, dict) or not all(c in value for c in 'RGBA'):
        raise MaterialGLSLError('Source color missing RGBA components')
    return [value[c] for c in 'RGBA']


def promote(expr, width):
    if expr.width == width:
        return expr.code
    if expr.width == 1 and width in (2, 3, 4):
        return f'vec{width}({expr.code})'
    raise MaterialGLSLError('Unsafe mixed vector widths')


def binary(a, b, operator):
    width = max(a.width, b.width)
    return Expr(f'({promote(a, width)} {operator} {promote(b, width)})', width)


class Compiler:
    def __init__(self, graph):
        if (not isinstance(graph, dict) or graph.get('schema_version') != 1
                or graph.get('status') != 'direct_connections_recovered'
                or not isinstance(graph.get('nodes'), list)
                or not isinstance(graph.get('roots'), dict)):
            raise MaterialGLSLError('Requires source-witnessed material graph v1')
        self.nodes = {}
        for item in graph['nodes']:
            if (not isinstance(item, dict) or type(item.get('index')) is not int
                    or item['index'] <= 0 or item['index'] in self.nodes
                    or not isinstance(item.get('inputs'), dict)):
                raise MaterialGLSLError('Invalid/duplicate source export index')
            self.nodes[item['index']] = item
        self.roots = graph['roots']
        self.active, self.memo, self.uniforms = set(), {}, {}
        self.visited = set()

    def input(self, data):
        if not isinstance(data, dict) or type(data.get('expression')) is not int:
            raise MaterialGLSLError('Invalid native material link')
        index = data['expression']
        if index < 0:
            raise MaterialGLSLError('Negative expression reference')
        if index == 0:
            if data.get('use_constant') is True and isinstance(data.get('constant'), list):
                return vector(data['constant'])
            raise MaterialGLSLError('Unconnected input has no witnessed value')
        expr = self.node(index)
        # The graph parser does not yet recover the expression Outputs array.
        if data.get('output', 0) != 0:
            raise MaterialGLSLError('Selected expression output is not source-verified')
        mask = data.get('mask', [0, 0, 0, 0, 0])
        if (not isinstance(mask, list) or len(mask) != 5
                or any(x not in (0, 1) for x in mask)):
            raise MaterialGLSLError('Invalid source component mask')
        if mask[0]:
            indices = [i for i, flag in enumerate(mask[1:]) if flag]
            if not indices or any(i >= expr.width for i in indices):
                raise MaterialGLSLError('Component mask exceeds witnessed width')
            return Expr(f'({expr.code}).{"".join(CHANNELS[i] for i in indices)}', len(indices))
        return expr

    def required(self, node, key):
        if key not in node['inputs']:
            raise MaterialGLSLError('Source input absent: ' + key)
        return self.input(node['inputs'][key])

    def node(self, index):
        if index in self.memo:
            return self.memo[index]
        if index in self.active:
            raise MaterialGLSLError('Cyclic source material graph')
        if index not in self.nodes:
            raise MaterialGLSLError('Input references a non-expression export')
        node = self.nodes[index]
        cls = node.get('class', '')
        props = node.get('properties', {})
        if not isinstance(props, dict):
            raise MaterialGLSLError('Invalid witnessed source properties')
        self.active.add(index)
        try:
            if cls == 'MaterialExpressionConstant':
                expr = vector([props.get('R', 0)])
            elif cls == 'MaterialExpressionConstant2Vector':
                expr = vector([props.get('R', 0), props.get('G', 0)])
            elif cls == 'MaterialExpressionConstant3Vector':
                expr = vector(color(props, 'Constant')[:3])
            elif cls in ('MaterialExpressionScalarParameter', 'MaterialExpressionVectorParameter'):
                source_name = props.get('ParameterName')
                if not isinstance(source_name, str) or not source_name:
                    raise MaterialGLSLError('Original parameter name unavailable')
                vals = ([props.get('DefaultValue', 0)] if cls.endswith('ScalarParameter')
                        else color(props, 'DefaultValue'))
                uniform = f'uep_{index}'
                self.uniforms[uniform] = {'type': 'float' if len(vals) == 1 else 'vec4',
                                          'source_name': source_name,
                                          'source_export_index': index,
                                          'default': [number(v) for v in vals]}
                expr = Expr(uniform, len(vals))
            elif cls in ('MaterialExpressionReroute', 'MaterialExpressionNamedRerouteDeclaration'):
                expr = self.required(node, 'Input')
            elif cls in ('MaterialExpressionAdd', 'MaterialExpressionSubtract',
                         'MaterialExpressionMultiply', 'MaterialExpressionDivide'):
                operator = {'MaterialExpressionAdd': '+', 'MaterialExpressionSubtract': '-',
                            'MaterialExpressionMultiply': '*', 'MaterialExpressionDivide': '/'}[cls]
                expr = binary(self.required(node, 'A'), self.required(node, 'B'), operator)
            elif cls == 'MaterialExpressionOneMinus':
                expr = binary(vector([1]), self.required(node, 'Input'), '-')
            elif cls == 'MaterialExpressionSaturate':
                x = self.required(node, 'Input')
                expr = Expr(f'clamp({x.code}, {promote(vector([0]), x.width)}, {promote(vector([1]), x.width)})', x.width)
            elif cls in ('MaterialExpressionAbs', 'MaterialExpressionFloor',
                         'MaterialExpressionSine', 'MaterialExpressionCosine', 'MaterialExpressionFrac'):
                name = {'MaterialExpressionAbs': 'abs', 'MaterialExpressionFloor': 'floor',
                        'MaterialExpressionSine': 'sin', 'MaterialExpressionCosine': 'cos',
                        'MaterialExpressionFrac': 'fract'}[cls]
                value = self.required(node, 'Input')
                expr = Expr(f'{name}({value.code})', value.width)
            elif cls == 'MaterialExpressionLinearInterpolate':
                a, b, alpha = [self.required(node, key) for key in ('A', 'B', 'Alpha')]
                width = max(a.width, b.width)
                if alpha.width not in (1, width):
                    raise MaterialGLSLError('Unverified interpolator alpha dimension')
                expr = Expr(f'mix({promote(a, width)}, {promote(b, width)}, {promote(alpha, width)})', width)
            elif cls == 'MaterialExpressionComponentMask':
                value = self.required(node, 'Input')
                indices = [i for i, key in enumerate('RGBA') if props.get(key, False) is True]
                if not indices or any(i >= value.width for i in indices):
                    raise MaterialGLSLError('Component mask exceeds source width')
                expr = Expr(f'({value.code}).{"".join(CHANNELS[i] for i in indices)}', len(indices))
            else:
                # No placeholder for missing textures/functions, particle state,
                # world position, attributes, post-process, custom code, etc.
                raise MaterialGLSLError('Unsupported witnessed material node: ' + cls)
            self.memo[index] = expr
            self.visited.add(index)
            return expr
        finally:
            self.active.remove(index)

    def root(self, name):
        if name not in ROOTS:
            raise MaterialGLSLError('Unsupported material root: ' + name)
        link = self.roots.get(name)
        if not link or not link.get('expression') and not link.get('use_constant'):
            return None
        expr = self.input(link)
        width = ROOTS[name]
        if expr.width != width:
            if expr.width == 4 and width == 3:
                expr = Expr(f'({expr.code}).xyz', 3)
            elif expr.width == 1 and width == 3:
                expr = Expr(promote(expr, 3), 3)
            else:
                raise MaterialGLSLError('Unsafe material root type conversion')
        return expr


def compile_graph(graph):
    """Compile independent roots as GLSL chunks; never claim shader/Play parity."""
    compiler = Compiler(graph)
    compiled, blocked = {}, {}
    for name in ROOTS:
        uniforms = dict(compiler.uniforms)
        try:
            result = compiler.root(name)
            if result is not None:
                compiled[name] = {'glsl': result.code, 'width': result.width}
        except MaterialGLSLError as error:
            compiler.uniforms = uniforms
            blocked[name] = str(error)
    # Connected roots not supported by this subset are explicitly blocked.
    for name, link in graph['roots'].items():
        if (name not in ROOTS and isinstance(link, dict)
                and (link.get('expression') or link.get('use_constant'))):
            blocked[name] = 'Source root requires separate vertex/lighting implementation'
    return {'schema_version': 1, 'shader_execution': 'not_integrated',
            'translated_roots': compiled, 'blocked_roots': blocked,
            'uniforms': compiler.uniforms, 'source_expression_count': len(compiler.visited),
            'requires': ['PBR shader integration', 'texture and instance bindings',
                         'lighting verification', 'visual comparison with original Unreal']}
