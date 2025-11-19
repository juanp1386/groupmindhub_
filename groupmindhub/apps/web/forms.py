from decimal import Decimal

from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import UserCreationForm

from groupmindhub.apps.core.models import (
    ProjectMembership,
    DEFAULT_VOTING_POOL_SIZE,
    DEFAULT_APPROVAL_THRESHOLD,
    DEFAULT_VOTING_DURATION_HOURS,
)


class SignupForm(UserCreationForm):
    email = forms.EmailField(required=False, help_text='Optional contact email.')

    class Meta(UserCreationForm.Meta):
        model = get_user_model()
        fields = ('username', 'email')


class ProjectInviteForm(forms.Form):
    email = forms.EmailField(help_text='Invitee email')
    role = forms.ChoiceField(choices=ProjectMembership.Role.choices, initial=ProjectMembership.Role.VIEWER)


class ProjectGovernanceForm(forms.Form):
    voting_pool_size = forms.IntegerField(
        min_value=1,
        max_value=1000,
        initial=DEFAULT_VOTING_POOL_SIZE,
        label='Voting pool size',
        help_text='Simulated number of voters represented in thresholds.',
    )
    approval_threshold = forms.DecimalField(
        min_value=Decimal('0.10'),
        max_value=Decimal('1.00'),
        decimal_places=2,
        max_digits=4,
        initial=DEFAULT_APPROVAL_THRESHOLD,
        label='Approval threshold',
        help_text='Percentage (0-1) of pool required to merge.',
    )
    voting_duration_hours = forms.IntegerField(
        min_value=1,
        max_value=240,
        initial=DEFAULT_VOTING_DURATION_HOURS,
        label='Voting duration (hours)',
        help_text='How long proposals stay open before closing.',
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for field in self.fields.values():
            existing_classes = field.widget.attrs.get('class', '')
            field.widget.attrs['class'] = (existing_classes + ' governance-input').strip()

    def clean_approval_threshold(self):
        value = self.cleaned_data['approval_threshold']
        return value.quantize(Decimal('0.01'))
