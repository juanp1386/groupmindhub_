from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import UserCreationForm


class SignupForm(UserCreationForm):
    email = forms.EmailField(required=False, help_text='Optional contact email.')

    class Meta(UserCreationForm.Meta):
        model = get_user_model()
        fields = ('username', 'email')
