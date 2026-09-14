"""Blender --background --threads 6 --python scripts/build_shop_blender.py
Rebuild static architecture + furniture. Viewer (x,y,z) maps to Blender (x,-z,y).
"""
import bpy, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'coffee-terminal/web/assets/scene'
SOURCE=ROOT/'art/coffee-shop'
OUT.mkdir(parents=True,exist_ok=True);SOURCE.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.bake.margin=12
scene.world=bpy.data.worlds.new('Daylight');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.68,.76,.86,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.35

def linear(h):
    v=[int(h[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in v)+(1,)
def material(name,color,rough=.7,metal=0,kind=None):
    m=bpy.data.materials.new(name);m.use_nodes=True
    n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF')
    p.inputs['Base Color'].default_value=linear(color);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    if kind:
        coord=n.new('ShaderNodeTexCoord');scale=n.new('ShaderNodeVectorMath');scale.operation='MULTIPLY'
        l.new(coord.outputs['Generated'],scale.inputs[0]);scale.inputs[1].default_value=(4,4,4) if kind=='stone' else (5,80,3) if kind=='oak' else (90,90,90)
        noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=5;noise.inputs['Detail'].default_value=3
        l.new(scale.outputs[0],noise.inputs['Vector']);ramp=n.new('ShaderNodeValToRGB')
        colors={'stone':('b6b1a0','eee5d5'),'oak':('765031','c99c69'),'plaster':('ded2be','f6f0e5')}[kind]
        for e,c in zip(ramp.color_ramp.elements,colors):e.color=linear(c)
        l.new(noise.outputs['Fac'],ramp.inputs[0]);l.new(ramp.outputs[0],p.inputs['Base Color'])
        if kind=='stone':
            vor=n.new('ShaderNodeTexVoronoi');vor.inputs['Scale'].default_value=95;l.new(coord.outputs['Generated'],vor.inputs['Vector'])
            chips=n.new('ShaderNodeValToRGB');chips.color_ramp.interpolation='CONSTANT'
            chips.color_ramp.elements[0].position=.12;chips.color_ramp.elements[0].color=linear('929984')
            chips.color_ramp.elements[1].position=.21;chips.color_ramp.elements[1].color=linear('e9dfcc')
            l.new(vor.outputs['Distance'],chips.inputs[0]);l.new(chips.outputs[0],p.inputs['Base Color'])
    return m
stone=material('Honed terrazzo','e9dfcc',.76,kind='stone');plaster=material('Mineral plaster','f6f0e5',.92,kind='plaster')
oak=material('Natural oak','b88952',.55,kind='oak');green=material('Forest upholstery','17382D',.86);brass=material('Brushed brass','B78A52',.35,.65)
objects=[]
def finish(obj,name,mat,bevel):
    obj.name=name;obj.data.materials.append(mat);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=obj.modifiers.new('Crafted edge','BEVEL');mod.width=bevel;mod.segments=3;bpy.ops.object.modifier_apply(modifier=mod.name)
    for poly in obj.data.polygons:poly.use_smooth=True
    mod=obj.modifiers.new('Weighted normals','WEIGHTED_NORMAL');mod.keep_sharp=True;bpy.ops.object.modifier_apply(modifier=mod.name)
    objects.append(obj);return obj
def box(name,size,pos,mat,bevel=.015):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(pos[0],-pos[2],pos[1]));obj=bpy.context.object;obj.dimensions=(size[0],size[2],size[1]);return finish(obj,name,mat,bevel)
def cyl(name,r,h,pos,mat,bevel=.009):
    bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=r,depth=h,location=(pos[0],-pos[2],pos[1]));return finish(bpy.context.object,name,mat,bevel)
box('Terrazzo floor',(7.6,.14,5.8),(0,-.07,.3),stone,.025)
box('Rear plaster wall',(7.6,3.5,.14),(0,1.75,-2.53),plaster)
box('Side plaster wall',(.14,3.5,5.8),(-3.73,1.75,.3),plaster)
box('Oak side ledge',(.43,.075,4.5),(-3.40,1.02,.30),oak)
for z in [-.7,1.1]:
    cyl('Stool foot',.20,.035,(-3.08,.025,z),brass);cyl('Stool pedestal',.032,.65,(-3.08,.36,z),brass,.004);cyl('Stool cushion',.22,.075,(-3.08,.72,z),green,.023)
    bpy.ops.mesh.primitive_torus_add(major_radius=.16,minor_radius=.012,major_segments=40,minor_segments=8,location=(-3.08,-z,.27));finish(bpy.context.object,'Stool footrest',brass,0)
for x,z in [(2.54,2.19),(3.12,2.60)]:
    cyl('Lounge plinth',.255,.055,(x,.04,z),brass);cyl('Lounge upholstery',.27,.39,(x,.255,z),green,.025);cyl('Lounge seat piping',.269,.045,(x,.467,z),green,.014)
cyl('Table foot',.16,.035,(3.20,.03,1.76),brass);cyl('Table stem',.075,.52,(3.20,.28,1.76),oak);cyl('Oak table top',.30,.045,(3.20,.565,1.76),oak,.012)
bpy.ops.object.select_all(action='DESELECT')
for obj in objects:obj.select_set(True)
bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();asset=bpy.context.object;asset.name='coffee-shop-baked-static-v1'
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.012);bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.light_add(type='SUN',location=(7,-3,6));sun=bpy.context.object;sun.rotation_euler=(math.radians(27),math.radians(-30),math.radians(-35));sun.data.energy=2;sun.data.angle=.12
bpy.ops.object.light_add(type='AREA',location=(2,0,5));bpy.context.object.data.energy=180;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=5
bpy.ops.object.select_all(action='DESELECT');asset.select_set(True);bpy.context.view_layer.objects.active=asset
materials=list(asset.data.materials)
def bake(name,kind,passes):
    img=bpy.data.images.new(name,width=1024,height=1024,alpha=False);img.colorspace_settings.name='sRGB' if kind=='DIFFUSE' else 'Non-Color'
    for m in materials:
        node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=img;m.node_tree.nodes.active=node
    scene.render.bake.use_pass_color='COLOR' in passes;scene.render.bake.use_pass_direct='DIRECT' in passes;scene.render.bake.use_pass_indirect='INDIRECT' in passes
    bpy.ops.object.bake(type=kind);img.filepath_raw=str(SOURCE/(name+'.png'));img.file_format='PNG';img.save();img.pack();return img
base=bake('shop-basecolor','DIFFUSE',{'COLOR'});ao=bake('shop-occlusion','AO',set());indirect=bake('shop-indirect','DIFFUSE',{'COLOR','INDIRECT'})
for m in materials:
    n=m.node_tree.nodes;l=m.node_tree.links;p=n.get('Principled BSDF')
    for link in list(p.inputs['Base Color'].links):l.remove(link)
    tex=n.new('ShaderNodeTexImage');tex.image=base;l.new(tex.outputs['Color'],p.inputs['Base Color'])
    tex=n.new('ShaderNodeTexImage');tex.image=indirect;l.new(tex.outputs['Color'],p.inputs['Emission Color']);p.inputs['Emission Strength'].default_value=.35
    group=bpy.data.node_groups.get('glTF Material Output')
    if not group:
        group=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree');group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
    output=n.new('ShaderNodeGroup');output.node_tree=group;tex=n.new('ShaderNodeTexImage');tex.image=ao;l.new(tex.outputs['Color'],output.inputs['Occlusion'])
asset['asset_version']=1;asset['bake']='1024px color, AO, indirect diffuse; static only'
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'coffee-shop.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'coffee-shop-v1.glb'),export_format='GLB',use_selection=True,export_cameras=False,export_lights=False)
print('SHOP_ASSET_COMPLETE',OUT/'coffee-shop-v1.glb')
