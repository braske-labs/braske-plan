from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.reverse import reverse
from rest_framework.views import APIView

from .models import Asset, Project, User
from .serializers import (
    ActiveRevisionUpdateSerializer,
    AssetSerializer,
    ProjectCreateSerializer,
    ProjectSerializer,
    RevisionSerializer,
    UserSerializer,
)


class ApiRootView(APIView):
    def get(self, request):
        projects_url = reverse("project-list", request=request)
        return Response(
            {
                "users": reverse("user-list", request=request),
                "projects": projects_url,
                "project_routes": {
                    "detail": {
                        "path_template": "/api/projects/{project_id}/",
                        "description": "Fetch one project by UUID.",
                    },
                    "active_revision": {
                        "path_template": "/api/projects/{project_id}/active-revision/",
                        "description": "Read or update the active draft revision for a project.",
                    },
                    "assets": {
                        "path_template": "/api/projects/{project_id}/assets/",
                        "description": "List or upload project assets such as floor-plan images.",
                    },
                },
            }
        )


class UserListCreateView(generics.ListCreateAPIView):
    queryset = User.objects.all()
    serializer_class = UserSerializer


class ProjectListCreateView(generics.ListCreateAPIView):
    queryset = Project.objects.select_related("user", "active_revision").all()

    def get_queryset(self):
        queryset = Project.objects.select_related("user", "active_revision").all()
        user_id = self.request.query_params.get("user")
        if user_id:
            queryset = queryset.filter(user_id=user_id)
        return queryset

    def get_serializer_class(self):
        if self.request.method == "POST":
            return ProjectCreateSerializer
        return ProjectSerializer


class ProjectDetailView(generics.RetrieveAPIView):
    queryset = Project.objects.select_related("user", "active_revision").all()
    serializer_class = ProjectSerializer


class ActiveRevisionView(generics.RetrieveUpdateAPIView):
    serializer_class = RevisionSerializer

    def get_object(self):
        project = get_object_or_404(
            Project.objects.select_related("active_revision"),
            pk=self.kwargs["pk"],
        )
        revision = project.active_revision
        if revision is None:
            raise Http404("Project has no active revision.")
        return revision

    def get_serializer_class(self):
        if self.request.method in {"PUT", "PATCH"}:
            return ActiveRevisionUpdateSerializer
        return RevisionSerializer


class ProjectAssetListCreateView(generics.ListCreateAPIView):
    serializer_class = AssetSerializer

    def get_project(self):
        return get_object_or_404(Project, pk=self.kwargs["pk"])

    def get_queryset(self):
        return Asset.objects.filter(project=self.get_project())

    def perform_create(self, serializer):
        uploaded_file = serializer.validated_data["file"]
        serializer.save(
            project=self.get_project(),
            original_filename=uploaded_file.name,
        )
