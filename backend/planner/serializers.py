from rest_framework import serializers

from .models import Asset, Project, Revision, User
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


class AssetSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    file = serializers.FileField(write_only=True)

    class Meta:
        model = Asset
        fields = ["id", "project", "original_filename", "url", "created_at", "file"]
        read_only_fields = ["id", "project", "original_filename", "url", "created_at"]

    def get_url(self, obj):
        request = self.context.get("request")
        if not obj.file:
            return None
        file_url = obj.file.url
        if request is None:
            return file_url
        return request.build_absolute_uri(file_url)


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
