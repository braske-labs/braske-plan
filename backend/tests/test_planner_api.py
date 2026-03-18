import uuid

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from planner.models import Asset, Project, Revision, User


@pytest.mark.django_db
def test_api_root_lists_entry_points():
    client = APIClient()

    response = client.get("/api/")

    assert response.status_code == 200
    assert response.data["users"].endswith("/api/users/")
    assert response.data["projects"].endswith("/api/projects/")
    assert (
        response.data["project_routes"]["detail"]["path_template"] == "/api/projects/{project_id}/"
    )
    assert (
        response.data["project_routes"]["active_revision"]["path_template"]
        == "/api/projects/{project_id}/active-revision/"
    )
    assert (
        response.data["project_routes"]["assets"]["path_template"]
        == "/api/projects/{project_id}/assets/"
    )


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


@pytest.mark.django_db
def test_project_assets_can_be_uploaded_and_listed(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    client = APIClient()
    user = User.objects.create(name="Ieva")
    project = Project.objects.create(user=user, name="Home plan")
    image_file = SimpleUploadedFile(
        "floor-plan.png",
        (
            b"\x89PNG\r\n\x1a\n"
            b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDAT"
            b"\x08\xd7c\xf8\xff\xff?\x00\x05\xfe\x02\xfeA\xa6\x8f\xb1"
            b"\x00\x00\x00\x00IEND\xaeB`\x82"
        ),
        content_type="image/png",
    )

    create_response = client.post(
        f"/api/projects/{project.id}/assets/",
        {"file": image_file},
        format="multipart",
    )

    assert create_response.status_code == 201
    assert create_response.data["original_filename"] == "floor-plan.png"
    assert create_response.data["url"].endswith(".png")

    list_response = client.get(f"/api/projects/{project.id}/assets/")

    assert list_response.status_code == 200
    assert len(list_response.data) == 1
    assert list_response.data[0]["id"] == create_response.data["id"]
    assert Asset.objects.filter(project=project).count() == 1
