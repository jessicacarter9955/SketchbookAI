"""Additional source-witnessed UE 5.7 pure KismetMath signatures.

Contracts checked against the installed Engine/Classes/Kismet/KismetMathLibrary.h,
KismetMathLibrary.inl and Core math implementations. Names remain exact reflected
UFunction names; this is not a permissive arithmetic or method-name fallback.
"""

# (bytecode argument count, output source type). Out references are included in
# argument count, while INPUT_TYPES describes input arguments only.
MATH_CALLS = {
    'VLerp': (3, 'vector_lerp'),
    'Divide_IntInt': (2, 'IntInt'),
    'Percent_IntInt': (2, 'IntInt'),
    'NearlyEqual_FloatFloat': (3, 'double_nearly_equal'),
    'MapRangeClamped': (5, 'double_range_map'),
    'Conv_RotatorToVector': (1, 'RotatorVector'),
    'Conv_VectorToRotator': (1, 'VectorRotator'),
    'GreaterGreater_VectorRotator': (2, 'VectorRotatorVector'),
    'GetUpVector': (1, 'RotatorVector'),
    'NotEqual_VectorVector': (3, 'VectorVectorTolerance'),
    'ProjectPointOnToPlane': (3, 'VectorVectorVector'),
    'SelectTransform': (3, 'transform_select'),
    'SelectRotator': (3, 'rotator_select'),
    'MakeVector2D': (2, 'vector2d'),
    'BreakVector2D': (3, 'break_vector2d'),
    'RInterpTo': (4, 'rotator_interp'),
    'NormalizedDeltaRotator': (2, 'rotator_delta'),
    'MakeRelativeTransform': (2, 'transform_relative'),
    'Conv_IntToBool': (1, 'int_to_bool'),
}
INPUT_TYPES = {
    'VLerp': ('Vector','Vector','FloatProperty'),
    'Divide_IntInt': ('IntProperty', 'IntProperty'),
    'Percent_IntInt': ('IntProperty', 'IntProperty'),
    'NearlyEqual_FloatFloat': ('DoubleProperty',)*3,
    'MapRangeClamped': ('DoubleProperty',)*5,
    'Conv_RotatorToVector': ('Rotator',),
    'Conv_VectorToRotator': ('Vector',),
    'GreaterGreater_VectorRotator': ('Vector', 'Rotator'),
    'GetUpVector': ('Rotator',),
    'NotEqual_VectorVector': ('Vector', 'Vector', 'FloatProperty'),
    'ProjectPointOnToPlane': ('Vector', 'Vector', 'Vector'),
    'SelectTransform': ('Transform', 'Transform', 'BoolProperty'),
    'SelectRotator': ('Rotator', 'Rotator', 'BoolProperty'),
    'MakeVector2D': ('DoubleProperty', 'DoubleProperty'),
    'BreakVector2D': ('Vector2D',),
    'RInterpTo': ('Rotator', 'Rotator', 'FloatProperty', 'FloatProperty'),
    'NormalizedDeltaRotator': ('Rotator', 'Rotator'),
    'MakeRelativeTransform': ('Transform', 'Transform'),
    'Conv_IntToBool': ('IntProperty',),
}
RESULT_TYPES = {
    'VLerp': 'Vector',
    'SelectRotator': 'Rotator',
    'Divide_IntInt': 'IntProperty', 'Percent_IntInt': 'IntProperty',
    'NearlyEqual_FloatFloat': 'BoolProperty', 'MapRangeClamped': 'DoubleProperty',
    'Conv_RotatorToVector': 'Vector', 'Conv_VectorToRotator': 'Rotator',
    'GreaterGreater_VectorRotator': 'Vector', 'GetUpVector': 'Vector',
    'NotEqual_VectorVector': 'BoolProperty', 'ProjectPointOnToPlane': 'Vector',
    'SelectTransform': 'Transform', 'MakeVector2D': 'Vector2D',
    'RInterpTo': 'Rotator', 'NormalizedDeltaRotator': 'Rotator',
    'MakeRelativeTransform': 'Transform', 'Conv_IntToBool': 'BoolProperty',
}
