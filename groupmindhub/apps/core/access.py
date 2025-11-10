from __future__ import annotations

from typing import Optional

from .models import Project, ProjectInvite


INVITE_SESSION_KEY = 'project_invites'


def remember_invite(request, project_id: int, signed_token: str) -> None:
    tokens = request.session.get(INVITE_SESSION_KEY, {})
    tokens[str(project_id)] = signed_token
    request.session[INVITE_SESSION_KEY] = tokens
    request.session.modified = True


def forget_invite(request, project_id: int) -> None:
    tokens = request.session.get(INVITE_SESSION_KEY)
    if not tokens:
        return
    if str(project_id) in tokens:
        tokens.pop(str(project_id))
        request.session[INVITE_SESSION_KEY] = tokens
        request.session.modified = True


def resolve_invite(request, project: Project, persist: bool = False) -> Optional[ProjectInvite]:
    candidates: list[tuple[str, str]] = []
    query_token = request.GET.get('invite') if hasattr(request, 'GET') else None
    if query_token:
        candidates.append(('query', query_token))
    header_token = request.META.get('HTTP_X_PROJECT_INVITE') if hasattr(request, 'META') else None
    if header_token:
        candidates.append(('header', header_token))
    stored_tokens = request.session.get(INVITE_SESSION_KEY, {}) if hasattr(request, 'session') else {}
    session_token = stored_tokens.get(str(project.id))
    if session_token:
        candidates.append(('session', session_token))

    for source, signed_token in candidates:
        invite = ProjectInvite.from_signed_token(signed_token)
        if invite and invite.project_id == project.id and invite.is_active:
            if persist and source in {'query', 'header'}:
                remember_invite(request, project.id, signed_token)
            return invite
        if source == 'session' and (not invite or invite.project_id != project.id or not invite.is_active):
            forget_invite(request, project.id)
    return None
