from django.urls import path

from .views import (
    ActiveRevisionView,
    ApiRootView,
    ProjectDetailView,
    ProjectListCreateView,
    UserListCreateView,
)

urlpatterns = [
    path("", ApiRootView.as_view(), name="api-root"),
    path("users/", UserListCreateView.as_view(), name="user-list"),
    path("projects/", ProjectListCreateView.as_view(), name="project-list"),
    path("projects/<uuid:pk>/", ProjectDetailView.as_view(), name="project-detail"),
    path(
        "projects/<uuid:pk>/active-revision/",
        ActiveRevisionView.as_view(),
        name="active-revision",
    ),
]
