from django.contrib import admin

from .models import Asset, Project, Revision, User


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "created_at")
    search_fields = ("id", "name")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "user", "active_revision", "created_at")
    search_fields = ("id", "name", "user__name")
    autocomplete_fields = ("user", "active_revision")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(Revision)
class RevisionAdmin(admin.ModelAdmin):
    list_display = ("id", "project", "state", "revision_number", "label", "created_at")
    list_filter = ("state", "created_at")
    search_fields = ("id", "project__name", "label")
    autocomplete_fields = ("project", "based_on")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(Asset)
class AssetAdmin(admin.ModelAdmin):
    list_display = ("id", "project", "original_filename", "created_at")
    search_fields = ("id", "project__name", "original_filename", "file")
    autocomplete_fields = ("project",)
    readonly_fields = ("id", "created_at")
