import uuid

from django.db import models


class RevisionQuerySet(models.QuerySet):
    def saved(self):
        return self.filter(state=Revision.State.SAVED)

    def chronological(self):
        return self.order_by("created_at")


class User(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return self.name or str(self.id)


class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey("planner.User", on_delete=models.CASCADE, related_name="projects")
    name = models.CharField(max_length=255)
    active_revision = models.ForeignKey(
        "planner.Revision",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="active_for_projects",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return self.name


class Revision(models.Model):
    class State(models.TextChoices):
        DRAFT = "draft", "Draft"
        SAVED = "saved", "Saved"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "planner.Project", on_delete=models.CASCADE, related_name="revisions"
    )
    state = models.CharField(max_length=16, choices=State.choices)
    revision_number = models.PositiveIntegerField(null=True, blank=True)
    label = models.CharField(max_length=255, blank=True)
    plan_json = models.JSONField(default=dict)
    based_on = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="derived_revisions",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = RevisionQuerySet.as_manager()

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.project.name} {self.state}"


class Asset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey("planner.Project", on_delete=models.CASCADE, related_name="assets")
    file = models.FileField(upload_to="assets/")
    original_filename = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return self.original_filename or self.file.name
