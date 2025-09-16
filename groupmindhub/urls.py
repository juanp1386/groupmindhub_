from django.contrib import admin
from django.urls import path
from groupmindhub.apps.web.views import (
    index, project_detail, entry_detail, patch_detail,
    login_view, logout_view, prototype_view, app_view, clone_view,
    project_new, project_star_toggle
)
from groupmindhub.apps.core.api import (
    api_project_entry, api_project_patches_list, api_project_patches_create,
    api_patch_vote, api_patch_merge
)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', index, name='index'),
    path('projects/<int:project_id>/', project_detail, name='project_detail'),
    path('projects/new/', project_new, name='project_new'),
    path('entries/<int:entry_id>/', entry_detail, name='entry_detail'),
    path('patches/<int:patch_id>/', patch_detail, name='patch_detail'),
    path('login/', login_view, name='login'),
    path('logout/', logout_view, name='logout'),
    path('prototype/', prototype_view, name='prototype'),
    path('clone/', clone_view, name='clone'),
    path('app/', app_view, name='app_default'),
    path('app/<int:project_id>/', app_view, name='app'),
    # API (prefixed with /api/...)
    path('api/projects/<int:project_id>/entry', api_project_entry, name='api_project_entry'),
    path('api/projects/<int:project_id>/patches', api_project_patches_list, name='api_project_patches_list'),
    path('api/projects/<int:project_id>/patches/create', api_project_patches_create, name='api_project_patches_create'),
    path('api/patches/<int:patch_id>/votes', api_patch_vote, name='api_patch_vote'),
    path('api/patches/<int:patch_id>/merge', api_patch_merge, name='api_patch_merge'),
    path('api/projects/<int:project_id>/star-toggle', project_star_toggle, name='project_star_toggle'),
]
