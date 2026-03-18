from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import generics
from rest_framework.response import Response
from rest_framework.reverse import reverse
from rest_framework.views import APIView

from .models import Project, User
from .serializers import (
    ActiveRevisionUpdateSerializer,
    ProjectCreateSerializer,
    ProjectSerializer,
    RevisionSerializer,
    UserSerializer,
)


class ApiRootView(APIView):
    def get(self, request):
        return Response(
            {
                "users": reverse("user-list", request=request),
                "projects": reverse("project-list", request=request),
            }
        )


class UserListCreateView(generics.ListCreateAPIView):
    queryset = User.objects.all()
    serializer_class = UserSerializer


class ProjectListCreateView(generics.ListCreateAPIView):
    queryset = Project.objects.select_related("user", "active_revision").all()

    def get_queryset(self):
        queryset = self.queryset
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
