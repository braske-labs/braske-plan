import uuid

import pytest
from rest_framework.test import APIClient

from planner.models import Project, Revision, User


@pytest.mark.django_db
def test_create_project_creates_active_draft_revision():
    client = APIClient()
    user = User.objects.create(name="Ieva")

    response = client.post(
        "/api/projects/",
        {
            "user": str(user.id),
            "name": "Home plan",
        },
        format="json",
    )

    assert response.status_code == 201
    project = Project.objects.get(id=response.data["id"])
    assert project.active_revision is not None
    assert project.active_revision.state == Revision.State.DRAFT
    assert project.active_revision.plan_json["meta"]["name"] == "Home plan"


@pytest.mark.django_db
def test_list_projects_can_be_filtered_by_user():
    client = APIClient()
    matching_user = User.objects.create(name="Ieva")
    other_user = User.objects.create(name="Other")
    Project.objects.create(user=other_user, name="Other project")
    project = Project.objects.create(user=matching_user, name="Matching project")

    response = client.get(f"/api/projects/?user={matching_user.id}")

    assert response.status_code == 200
    assert [item["id"] for item in response.data] == [str(project.id)]


@pytest.mark.django_db
def test_active_revision_can_be_updated():
    client = APIClient()
    user = User.objects.create(name="Ieva")
    project = Project.objects.create(user=user, name="Home plan")
    revision = Revision.objects.create(
        project=project,
        state=Revision.State.DRAFT,
        plan_json={"version": 1, "entities": {"rectangles": []}},
    )
    project.active_revision = revision
    project.save(update_fields=["active_revision"])

    response = client.patch(
        f"/api/projects/{project.id}/active-revision/",
        {
            "label": "Latest draft",
            "plan_json": {
                "version": 1,
                "entities": {"rectangles": [{"id": str(uuid.uuid4())}]},
            },
        },
        format="json",
    )

    assert response.status_code == 200
    revision.refresh_from_db()
    assert revision.label == "Latest draft"
    assert len(revision.plan_json["entities"]["rectangles"]) == 1
