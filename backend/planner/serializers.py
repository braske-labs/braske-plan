from rest_framework import serializers

from .models import Project, Revision, User
from .services import create_project_with_draft


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "name", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class RevisionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Revision
        fields = [
            "id",
            "project",
            "state",
            "revision_number",
            "label",
            "plan_json",
            "based_on",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "project",
            "state",
            "revision_number",
            "based_on",
            "created_at",
            "updated_at",
        ]


class ProjectSerializer(serializers.ModelSerializer):
    active_revision = RevisionSerializer(read_only=True)

    class Meta:
        model = Project
        fields = [
            "id",
            "user",
            "name",
            "active_revision",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "active_revision", "created_at", "updated_at"]


class ProjectCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = ["id", "user", "name", "active_revision", "created_at", "updated_at"]
        read_only_fields = ["id", "active_revision", "created_at", "updated_at"]

    def create(self, validated_data):
        return create_project_with_draft(**validated_data)


class ActiveRevisionUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Revision
        fields = ["label", "plan_json"]
