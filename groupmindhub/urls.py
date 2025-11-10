from django.contrib import admin
from django.urls import path
from groupmindhub.apps.web.views import (
    index, project_detail, entry_detail, change_detail, updates,
    prototype_view, app_view, clone_view,
    project_new, project_star_toggle
)
from groupmindhub.apps.web.views_auth import login_view, logout_view, signup_view
from groupmindhub.apps.core.api import (
    api_project_entry, api_project_changes_list, api_project_changes_create,
    api_change_vote, api_change_merge
)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', index, name='index'),
    path('projects/<int:project_id>/', project_detail, name='project_detail'),
    path('projects/new/', project_new, name='project_new'),
    path('entries/<int:entry_id>/', entry_detail, name='entry_detail'),
    path('updates/', updates, name='updates'),
    path('changes/<int:change_id>/', change_detail, name='change_detail'),
    path('login/', login_view, name='login'),
    path('logout/', logout_view, name='logout'),
    path('signup/', signup_view, name='signup'),
    path('prototype/', prototype_view, name='prototype'),
    path('clone/', clone_view, name='clone'),
    path('app/', app_view, name='app_default'),
    path('app/<int:project_id>/', app_view, name='app'),
    # API (prefixed with /api/...)
    path('api/projects/<int:project_id>/entry', api_project_entry, name='api_project_entry'),
    path('api/projects/<int:project_id>/changes', api_project_changes_list, name='api_project_changes_list'),
    path('api/projects/<int:project_id>/changes/create', api_project_changes_create, name='api_project_changes_create'),
    path('api/changes/<int:change_id>/votes', api_change_vote, name='api_change_vote'),
    path('api/changes/<int:change_id>/merge', api_change_merge, name='api_change_merge'),
    path('api/projects/<int:project_id>/star-toggle', project_star_toggle, name='project_star_toggle'),
]
