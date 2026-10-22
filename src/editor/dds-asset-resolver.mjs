export const DDS_ASSET_BASES = Object.freeze({
  legacy: 'build/local-scenes/dds/',
  ue2three: 'build/local-scenes/ue2three/projects/VIPExtractionKitDDS-23a280ac11/dds-assets/character/'
});
export const selectedDdsAssetSource = search =>
  new URLSearchParams(search || '').get('ddsAssets') === 'ue2three' ? 'ue2three' : 'legacy';

export function resolveDdsAssets(input, source = 'legacy') {
  if (!DDS_ASSET_BASES[source] || !input || typeof input !== 'object')
    throw new Error('Unsupported DDS asset source');
  const clips = input.clips || {};
  const weapons = source === 'ue2three'
    ? Object.fromEntries(['rifle','pistol'].map(id => [id, input.attachment_assets?.[id]?.file]))
    : input.weapons || {};
  const weaponClips = source === 'ue2three'
    ? Object.fromEntries(['rifle','pistol'].filter(id => clips['weapon_' + id + '_fire'])
       .map(id => [id, clips['weapon_' + id + '_fire']]))
    : input.weaponClips || {};
  const needed = ['idle','run','crouch_walk','heal','rifle_aim','rifle_fire',
                  'rifle_reload','pistol_aim','pistol_fire','pistol_reload'];
  if (!needed.every(id => clips[id]) || !weapons.rifle || !weapons.pistol)
    throw new Error('DDS required clips or weapons missing');
  for (const name of [input.mesh, ...Object.values(clips),
                      ...Object.values(weapons), ...Object.values(weaponClips)])
    if (typeof name !== 'string' || !/^[a-z0-9_-]+\.glb$/i.test(name))
      throw new Error('Invalid DDS asset filename');
  return {base: DDS_ASSET_BASES[source], source, mesh: input.mesh,
          clips, weapons, weaponClips};
}
