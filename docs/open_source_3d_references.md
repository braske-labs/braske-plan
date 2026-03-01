# Open-Source 3D Apartment Planner References

Saved on: 2026-03-01

## Floorplanner-style (2D draw + instant 3D)
- [furnishup/blueprint3d (MIT)](https://github.com/furnishup/blueprint3d) — very close to the “draw plan + see 3D apartment” flow.
- [amitukind/architect3d](https://github.com/amitukind/architect3d) — same family of floorplan + 3D interior editor.

## BIM/OpenBIM-style (heavier, robust IFC ecosystem)
- [IfcOpenShell](https://github.com/IfcOpenShell/IfcOpenShell) + [Bonsai docs](https://docs.ifcopenshell.org/bonsai.html).
- [That Open Components](https://docs.thatopen.com/) — current maintained direction; [web-ifc-viewer is deprecated](https://github.com/ThatOpen/web-ifc-viewer).
- [xeokit SDK](https://xeokit.io/) / [xeokit-bim-viewer](https://xeokit.github.io/xeokit-bim-viewer/) — strong performance, AGPL for OSS usage.

## Desktop references
- [FreeCAD](https://github.com/FreeCAD/FreeCAD) (BIM support; [old BIM_Workbench note](https://github.com/yorikvanhavre/BIM_Workbench)).
- [Sweet Home 3D (GPLv2)](https://sourceforge.net/projects/sweethome3d/).

## Practical recommendation for this project
- Use the current rectangle/wall model for production logic.
- Borrow interaction ideas from `blueprint3d`-style projects.
- Delay heavy BIM integration unless IFC import/export becomes a hard requirement.
