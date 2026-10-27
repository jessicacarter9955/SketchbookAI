"""Source typed Actor role queries, requiring explicit live role bindings."""
from blueprint_types import import_path

ROLE_QUERIES = {
    ('/Script/Engine','Actor','HasAuthority'): 'BoolProperty',
    ('/Script/Engine','Actor','GetLocalRole'): 'ByteProperty',
    ('/Script/Engine','Actor','GetRemoteRole'): 'ByteProperty',
}


def actor_role_query(value, package, owner, reads, outputs, depth):
    from blueprint_migration import kind, memory_size, BlueprintTranslationError as Error
    from blueprint_effects import variable
    call=value.get('ContextExpression',{})
    identity=import_path(package,call.get('StackNode'))
    if kind(call)!='EX_FinalFunction' or identity not in ROLE_QUERIES: return None
    ref=call.get('StackNode')
    if (type(ref) is not int or ref >= 0 or -ref > len(package.imports)
            or package.imports[-ref-1].get('ClassName')!='Function'
            or call.get('Parameters')!=[] or value.get('Offset')!=memory_size(call,package=package)):
        raise Error('Original Actor role query signature or context differs')
    target,schema=variable(value.get('ObjectExpression',{}),package,owner,reads,outputs,depth)
    if schema.get('reference_kind')!='runtime_actor':
        raise Error('Original Actor role query requires a typed live actor')
    return {'op':'native_actor_role','identity':list(identity),'dispatch':'EX_FinalFunction',
            'target':target,'actor_schema':schema,'return_type':ROLE_QUERIES[identity]}
