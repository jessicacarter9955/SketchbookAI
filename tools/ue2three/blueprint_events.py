"""Bounded reachability for a constant source Ubergraph entry (no guessed offsets)."""


def reachable_event(export, entry, package, kind, memory_size, error):
    code = export['ScriptBytecode']
    cache = getattr(package, '_event_layouts', {})
    key = id(export)
    layout = cache.get(key)
    if layout is None:
        offsets, boundaries, offset = {}, {}, 0
        for index, instruction in enumerate(code):
            offsets[index] = offset; boundaries[offset] = index
            offset += memory_size(instruction, package=package)
        layout = offsets, boundaries, offset
        cache[key] = layout
    offsets, boundaries, offset = layout
    if type(export.get('ScriptBytecodeSize')) is not int or offset != export['ScriptBytecodeSize']:
        raise error('Computed Kismet memory size differs from ScriptBytecodeSize')
    def target(address):
        if type(address) is not int or address not in boundaries:
            raise error('Event target is not a Kismet instruction boundary')
        return boundaries[address]
    target(entry)
    # Only the compiler-generated prologue is specialized. Other computed jumps
    # (including latent re-entry) cannot be inferred from an event argument.
    prologue = 1 if kind(code[0]) == 'EX_PushExecutionFlow' else 0
    jump = code[prologue]
    variable = jump.get('CodeOffsetExpression', {}).get('Variable', {}).get('New', {})
    if (kind(jump) != 'EX_ComputedJump' or kind(jump.get('CodeOffsetExpression', {})) != 'EX_LocalVariable'
            or variable.get('Path') != ['EntryPoint']
            or not package or package.export(variable.get('ResolvedOwner')) is not export):
        raise error('Unsupported event dispatch prologue')
    # A bounded abstract flow stack follows sequences exactly. Both outcomes of
    # conditions are retained; unsupported effects cannot hide behind a fixture.
    pending, visited, reachable = [(0, ())], set(), set()
    while pending:
        pc, stack = pending.pop()
        if (pc, stack) in visited: continue
        if len(visited) >= 20000 or len(stack) > 32:
            raise error('Event flow analysis budget exceeded')
        if not 0 <= pc < len(code): raise error('Event path falls outside source bytecode')
        visited.add((pc, stack)); reachable.add(pc)
        instruction = code[pc]; token = kind(instruction)
        if token == 'EX_Return': continue
        if token == 'EX_EndOfScript': raise error('Event path reaches EndOfScript without return')
        if token == 'EX_PushExecutionFlow':
            pending.append((pc+1, stack+(target(instruction.get('PushingAddress')),)))
        elif token == 'EX_ComputedJump':
            if pc != prologue: raise error('Unsupported computed jump inside event path')
            pending.append((target(entry), stack))
        elif token in ('EX_PopExecutionFlow', 'EX_PopExecutionFlowIfNot'):
            if not stack: raise error('Event path pops an empty flow stack')
            pending.append((stack[-1], stack[:-1]))
            if token == 'EX_PopExecutionFlowIfNot': pending.append((pc+1, stack))
        elif token in ('EX_Jump', 'EX_JumpIfNot'):
            pending.append((target(instruction.get('CodeOffset')), stack))
            if token == 'EX_JumpIfNot': pending.append((pc+1, stack))
        else: pending.append((pc+1, stack))
    return offsets, boundaries, offset, reachable, prologue
