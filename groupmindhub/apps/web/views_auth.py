from django.contrib.auth import login, logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import AuthenticationForm
from django.shortcuts import redirect, render
from django.views.decorators.http import require_http_methods

from .forms import SignupForm


def _next_url(request):
    return request.GET.get('next') or request.POST.get('next') or '/'


@require_http_methods(["GET", "POST"])
def signup_view(request):
    if request.user.is_authenticated:
        return redirect('index')
    form = SignupForm(request.POST or None)
    next_url = _next_url(request)
    if request.method == 'POST' and form.is_valid():
        user = form.save()
        login(request, user)
        return redirect(next_url)
    return render(request, 'signup.html', {
        'form': form,
        'next': next_url,
    })


@require_http_methods(["GET", "POST"])
def login_view(request):
    if request.user.is_authenticated:
        return redirect('index')
    form = AuthenticationForm(request, data=request.POST or None)
    next_url = _next_url(request)
    if request.method == 'POST' and form.is_valid():
        login(request, form.get_user())
        return redirect(next_url)
    return render(request, 'login.html', {
        'form': form,
        'next': next_url,
    })


@login_required
@require_http_methods(["GET", "POST"])
def logout_view(request):
    logout(request)
    return redirect('index')
