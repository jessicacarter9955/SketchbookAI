import struct, tempfile, unittest
from pathlib import Path
from fbx_geometry_diagnostic import convert
def prop(code,values):
 raw=struct.pack('<'+str(len(values))+code,*values)
 return code.encode()+struct.pack('<III',len(values),0,len(raw))+raw
def node(name,props,children,start):
 name=name.encode()
 head=struct.pack('<IIIB',0,len(props),sum(len(x) for x in props),len(name))+name+b''.join(props)
 body=b''
 for child in children:
  body+=node(*child,start+len(head)+len(body))
 data=head+body+bytes(13)
 return struct.pack('<I',start+len(data))+data[4:]
class FBXDiagnosticTests(unittest.TestCase):
 def test_triangle(self):
  vs=prop('d',[0,0,0,1,0,0,0,1,0])
  ix=prop('i',[0,1,-3])
  block=node('Geometry',[],[('Vertices',[vs],[]),('PolygonVertexIndex',[ix],[])],27)
  data=b'Kaydara FBX Binary  '+bytes([0,26,0])+struct.pack('<I',7300)+block+bytes(13)
  with tempfile.TemporaryDirectory() as tmp:
   inp=Path(tmp)/'x.fbx';out=Path(tmp)/'x.glb';inp.write_bytes(data)
   r=convert(inp,out)
   self.assertEqual((r['vertices'],r['triangles'],r['glb_meshes']),(3,1,1))
   self.assertEqual(out.read_bytes()[:4],b'glTF')
   self.assertEqual(r['material_fidelity'],'not_verified')
 def test_invalid(self):
  with tempfile.TemporaryDirectory() as tmp:
   src=Path(tmp)/'bad.fbx';src.write_bytes(b'bad input')
   with self.assertRaises(AssertionError):convert(src,Path(tmp)/'no.glb')
