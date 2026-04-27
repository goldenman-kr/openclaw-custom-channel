import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/api_contract_v1.dart';
import '../settings/app_settings.dart';

class ChatEngineException implements Exception {
  const ChatEngineException(this.message, {this.apiError, this.statusCode});

  final String message;
  final ApiErrorResponse? apiError;
  final int? statusCode;

  @override
  String toString() => message;
}

class ChatEngine {
  const ChatEngine({http.Client? httpClient}) : _httpClient = httpClient;

  final http.Client? _httpClient;

  Future<MessageResponse> sendMessage({
    required AppSettings settings,
    required String message,
    List<MessageAttachment> attachments = const [],
  }) async {
    final apiUrl = settings.apiUrl.trim().replaceAll(RegExp(r'/+$'), '');
    final apiKey = settings.apiKey.trim();
    if (apiUrl.isEmpty) {
      throw const ChatEngineException('API URL is required.');
    }
    if (apiKey.isEmpty) {
      throw const ChatEngineException('API Key is required.');
    }

    final request = buildMessageRequest(
      message: message,
      attachments: attachments,
    );

    final ownsClient = _httpClient == null;
    final client = _httpClient ?? http.Client();
    final http.Response response;
    try {
      response = await client.post(
        Uri.parse('$apiUrl/v1/message'),
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer $apiKey',
          if (settings.deviceId?.trim().isNotEmpty ?? false)
            'x-device-id': settings.deviceId!.trim(),
          if (settings.userId?.trim().isNotEmpty ?? false)
            'x-user-id': settings.userId!.trim(),
        },
        body: jsonEncode(request.toJson()),
      );
    } on Object catch (error) {
      throw ChatEngineException('서버에 연결하지 못했습니다: $error');
    } finally {
      if (ownsClient) {
        client.close();
      }
    }

    final Map<String, Object?> body;
    try {
      body = jsonDecode(response.body) as Map<String, Object?>;
    } on Object catch (error) {
      throw ChatEngineException(
        '서버 응답을 해석하지 못했습니다. status=${response.statusCode}, body=${response.body}, error=$error',
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final apiError = ApiErrorResponse.fromJson(body);
      throw ChatEngineException(
        apiError.message,
        apiError: apiError,
        statusCode: response.statusCode,
      );
    }

    return MessageResponse.fromJson(body);
  }
}
