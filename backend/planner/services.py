from django.db import transaction

from .models import Project, Revision, User


def build_empty_plan(*, project_name: str) -> dict:
    return {
        "version": 1,
        "planId": "",
        "meta": {
            "name": project_name or "Untitled plan",
        },
        "background": {
            "sourceType": "none",
            "source": "",
            "opacity": 0.35,
            "transform": {"x": 120, "y": 80, "width": 980, "height": 720},
        },
        "scale": {
            "metersPerWorldUnit": None,
            "referenceLine": None,
        },
        "settings": {
            "wallHeightMeters": 2.7,
        },
        "view": {
            "roomHighlighting": True,
            "wallsBlack": False,
        },
        "quote": {
            "groupMode": "room",
        },
        "entities": {
            "rectangles": [],
            "openings": [],
            "rooms": [],
            "lighting": {
                "fixtures": [],
                "links": [],
            },
        },
    }


@transaction.atomic
def create_project_with_draft(*, user: User, name: str) -> Project:
    project = Project.objects.create(user=user, name=name)
    draft = Revision.objects.create(
        project=project,
        state=Revision.State.DRAFT,
        plan_json=build_empty_plan(project_name=name),
    )
    project.active_revision = draft
    project.save(update_fields=["active_revision"])
    return project
