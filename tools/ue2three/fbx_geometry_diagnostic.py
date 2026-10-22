"""Diagnostic binary-FBX mesh geometry adapter for Unreal exports.

This is NOT a complete Unreal to glTF port: it does not preserve materials,
UVs, authored normals, transforms, animation, skeletons, Niagara or collision.
Never publish its geometry-only output as a validated 1:1 map. Use the normal
DDS source verification and runtime acceptance checks for that status.
Requires the optional Python dependency trimesh.
"""
import struct,zlib,json
from pathlib import Path
import trimesh
def parse(buf):
 assert buf.startswith(b'Kaydara FBX Binary')
 ver=struct.unpack_from('<I',buf,23)[0]
 wide=ver>=7500;hs=25 if wide else 13
 def prop(i):
  typ=chr(buf[i]);i+=1
  fmt={'Y':'h','I':'i','L':'q','F':'f','D':'d','C':'B'}
  if typ in fmt:
   c=fmt[typ];return struct.unpack_from('<'+c,buf,i)[0],i+struct.calcsize(c)
  if typ in 'SR':
   n=struct.unpack_from('<I',buf,i)[0];i+=4
   v=buf[i:i+n];return (v.decode('utf8','replace') if typ=='S' else v),i+n
  if typ in 'fdilbc':
   count,enc,n=struct.unpack_from('<III',buf,i);i+=12
   v=buf[i:i+n];i+=n
   if enc==1:v=zlib.decompress(v)
   c={'f':'f','d':'d','i':'i','l':'q','b':'B','c':'B'}[typ]
   assert len(v)==count*struct.calcsize(c)
   return struct.unpack('<'+str(count)+c,v),i
  raise ValueError(typ)
 def node(i):
  h=struct.unpack_from('<QQQ' if wide else '<III',buf,i)
  end,num,_=h
  if not end:return None,i+hs
  size=buf[i+hs-1];name=buf[i+hs:i+hs+size].decode()
  i+=hs+size;data=[]
  for _ in range(num):v,i=prop(i);data.append(v)
  kids=[]
  while i<end-hs:
   v,nxt=node(i)
   if v is None:break
   kids.append(v);i=nxt
  return (name,data,kids),end
 nodes=[];i=27
 while i<len(buf):
  n,i=node(i)
  if n is None:break
  nodes.append(n)
 return nodes

def find(nodes,key):
 result=[]
 for name,props,children in nodes:
  if name==key:result.append((name,props,children))
  result.extend(find(children,key))
 return result
def convert(src,dest):
 nodes=parse(Path(src).read_bytes())
 meshes=[]
 for geo in find(nodes,'Geometry'):
  vs=find([geo],'Vertices');ix=find([geo],'PolygonVertexIndex')
  if not vs or not ix:continue
  v=vs[0][1][0];indices=ix[0][1][0]
  assert len(v)%3==0 and len(v)>0
  vertices=[v[i:i+3] for i in range(0,len(v),3)]
  polys=[];face=[]
  for raw in indices:
   face.append(-raw-1 if raw<0 else raw)
   if raw<0:
    if len(face)>=3:
     for j in range(1,len(face)-1):polys.append((face[0],face[j],face[j+1]))
    face=[]
  assert not face and polys and all(0<=i<len(vertices) for tri in polys for i in tri)
  meshes.append(trimesh.Trimesh(vertices=vertices,faces=polys,process=False))
 assert meshes,'No original FBX geometry'
 scene=trimesh.Scene()
 for i,m in enumerate(meshes):scene.add_geometry(m,node_name='FBX_Geometry_'+str(i))
 data=scene.export(file_type='glb')
 Path(dest).write_bytes(data)
 doc=json.loads(data[20:20+struct.unpack_from('<I',data,12)[0]])
 return {'meshes':len(meshes),'vertices':sum(len(m.vertices) for m in meshes),
         'triangles':sum(len(m.faces) for m in meshes),'glb_bytes':len(data),
         'glb_meshes':len(doc['meshes']),'material_fidelity':'not_verified'}
if __name__=='__main__':
 import sys
 report=convert(sys.argv[1],sys.argv[2])
 Path(sys.argv[2]+'.diagnostic.json').write_text(json.dumps(report,indent=2))
 print('FBX_GLTF_DIAGNOSTIC',report,flush=True)
