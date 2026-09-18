"""Convert an expanded URDF serial chain into a twin robot configuration.
No ROS runtime or third-party Python packages are required. Mesh URI metadata is
reported, not downloaded or treated as collision geometry. Six revolute joints only.
"""
import argparse
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET


def values(text, default):
    result = [float(x) for x in text.split()] if text else default
    if len(result) != 3 or not all(math.isfinite(v) for v in result):
        raise ValueError("Expected three finite coordinates")
    return result


def origin(element):
    if element is None:
        return {"position": [0, 0, 0], "quaternion": [0, 0, 0, 1]}
    roll, pitch, yaw = values(element.get("rpy"), [0, 0, 0])
    cr, sr = math.cos(roll/2), math.sin(roll/2)
    cp, sp = math.cos(pitch/2), math.sin(pitch/2)
    cy, sy = math.cos(yaw/2), math.sin(yaw/2)
    return {"position": values(element.get("xyz"), [0, 0, 0]),
            "quaternion": [sr*cp*cy-cr*sp*sy, cr*sp*cy+sr*cp*sy,
                           cr*cp*sy-sr*sp*cy, cr*cp*cy+sr*sp*sy]}


def import_chain(path, base, tip, template):
    root = ET.parse(path).getroot()
    parents = {}
    for joint in root.findall("joint"):
        child = joint.find("child").get("link")
        if child in parents:
            raise ValueError(f"Multiple parents for {child}")
        parents[child] = joint
    chain, seen, link = [], set(), tip
    while link != base:
        if link in seen or link not in parents:
            raise ValueError("Tip must have a unique path to base")
        seen.add(link)
        joint = parents[link]
        chain.insert(0, joint)
        link = joint.find("parent").get("link")
    parsed, limits, joint_names, meshes = [], [], [], []
    for joint in chain:
        kind = joint.get("type")
        if kind not in ("fixed", "revolute", "continuous") or joint.find("mimic") is not None:
            raise ValueError("Only fixed and independent revolute joints are supported")
        entry = {"name": joint.get("name"), "type": kind, "origin": origin(joint.find("origin"))}
        if kind != "fixed":
            axis_element = joint.find("axis")
            axis = values(axis_element.get("xyz") if axis_element is not None else None, [1, 0, 0])
            length = math.sqrt(sum(x*x for x in axis))
            if length < 1e-9:
                raise ValueError("Zero joint axis")
            entry["axis"] = [x/length for x in axis]
            limit = joint.find("limit")
            if limit is None or "velocity" not in limit.attrib:
                raise ValueError("Joint velocity limits are required")
            lo = -2*math.pi if kind == "continuous" else float(limit.attrib["lower"])
            hi = 2*math.pi if kind == "continuous" else float(limit.attrib["upper"])
            limits.append({"min": lo, "max": hi, "velocity": float(limit.attrib["velocity"]),
                           "acceleration": template["limits"][len(limits)]["acceleration"],
                           "jerk": template["limits"][len(limits)]["jerk"]})
            joint_names.append(joint.get("name"))
        parsed.append(entry)
        child = joint.find("child").get("link")
        node = next((n for n in root.findall("link") if n.get("name") == child), None)
        if node is not None:
            for visual in node.findall("visual"):
                mesh = visual.find("geometry/mesh")
                if mesh is not None:
                    meshes.append({"link": child, "uri": mesh.get("filename"),
                                   "scale": values(mesh.get("scale"), [1, 1, 1]),
                                   "origin": origin(visual.find("origin"))})
    if len(limits) != 6:
        raise ValueError("Expected exactly six actuated joints")
    template.pop("dh", None)
    template.update({"model": root.get("name", "URDF"), "chain": parsed, "limits": limits,
                     "jointNames": joint_names, "visualMeshes": meshes})
    if any(not l["min"] <= q <= l["max"] for q, l in zip(template["home"], limits)):
        raise ValueError("Template home pose violates URDF limits; edit home first")
    return template


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("urdf", type=Path)
    parser.add_argument("--world", type=Path, default=Path(__file__).resolve().parents[1]/"config/twin/coffee-workcell-v1.json")
    parser.add_argument("--robot", required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--tip", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    world = json.loads(args.world.read_text())
    world["robots"][args.robot] = import_chain(args.urdf, args.base, args.tip, world["robots"][args.robot])
    world["calibration"] = "URDF chain imported; calibrate TCP, base, acceleration/jerk, collision radii and process times"
    args.output.write_text(json.dumps(world, ensure_ascii=False, indent=2)+"\n")
    print(f"Wrote {args.output}; inspect TCP/tool offset and collision approximation before running")


if __name__ == "__main__":
    main()
