"""Lossless diagnostic selection of Unreal world actors for glTF exports.

The Unreal exporter treats an empty selected-actor set as 'all actors', so an
explicit empty request must fail.  No actor is silently removed or renamed.
"""


def resolve_actor_selection(actors, requested_names=None):
    actors = list(actors)
    if requested_names is None:
        return set(), {"mode": "all", "available": len(actors), "selected": len(actors)}
    names = {}
    for actor in actors:
        name = actor.get_name()
        if name in names:
            raise ValueError(f"Duplicate Unreal actor identity: {name}")
        names[name] = actor
    if (not isinstance(requested_names, list) or not requested_names or
            any(not isinstance(name, str) or not name or "\x00" in name or len(name) > 256
                for name in requested_names)):
        raise ValueError("Actor subset must be a nonempty list of valid Unreal actor names")
    if len(set(requested_names)) != len(requested_names):
        raise ValueError("Actor subset contains duplicate Unreal identities")
    missing = sorted(set(requested_names) - set(names))
    if missing:
        raise ValueError(f"Selected Unreal actors not found in loaded world: {missing[:12]}")
    return {names[name] for name in requested_names}, {
        "mode": "subset", "available": len(names), "selected": len(requested_names),
        "actor_names": sorted(requested_names)}
