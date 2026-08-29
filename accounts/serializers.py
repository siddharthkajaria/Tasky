from django.contrib.auth import get_user_model
from rest_framework import serializers


class UserSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)

    class Meta:
        model = get_user_model()
        fields = ["id", "username", "display_name"]


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(style={"input_type": "password"})


class AdminUserSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)

    class Meta:
        model = get_user_model()
        fields = [
            "id", "username", "display_name", "first_name", "last_name",
            "is_active", "is_staff", "date_joined",
        ]
        read_only_fields = fields


class AdminUserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)

    class Meta:
        model = get_user_model()
        fields = ["id", "username", "password", "first_name", "last_name"]
        extra_kwargs = {
            "first_name": {"required": False},
            "last_name": {"required": False},
        }

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = get_user_model()(**validated_data)
        user.set_password(password)
        user.save()
        return user


class AdminUserUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = get_user_model()
        fields = ["is_active", "is_staff", "first_name", "last_name"]
