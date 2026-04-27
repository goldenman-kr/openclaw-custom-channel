import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mime/mime.dart';
import 'package:path/path.dart' as p;

import '../models/api_contract_v1.dart';

class AttachmentServiceException implements Exception {
  const AttachmentServiceException(this.message);

  final String message;

  @override
  String toString() => message;
}

class AttachmentService {
  AttachmentService({ImagePicker? imagePicker})
    : _imagePicker = imagePicker ?? ImagePicker();

  final ImagePicker _imagePicker;

  Future<MessageAttachment?> pickImage() async {
    final image = await _imagePicker.pickImage(source: ImageSource.gallery);
    if (image == null) {
      return null;
    }

    final bytes = await image.readAsBytes();
    final mimeType =
        image.mimeType ?? lookupMimeType(image.name, headerBytes: bytes);
    return _buildAttachment(
      type: 'image',
      name: image.name,
      mimeType: mimeType,
      bytes: bytes,
    );
  }

  Future<MessageAttachment?> pickFile() async {
    final result = await FilePicker.pickFiles(withData: true);
    final file = result?.files.singleOrNull;
    if (file == null) {
      return null;
    }

    final bytes = file.bytes;
    if (bytes == null) {
      throw const AttachmentServiceException('파일을 읽지 못했습니다.');
    }

    final mimeType = lookupMimeType(file.name, headerBytes: bytes);
    return _buildAttachment(
      type: 'file',
      name: p.basename(file.name),
      mimeType: mimeType,
      bytes: bytes,
    );
  }

  MessageAttachment _buildAttachment({
    required String type,
    required String name,
    required String? mimeType,
    required List<int> bytes,
  }) {
    if (bytes.length > maxAttachmentBytes) {
      throw const AttachmentServiceException('첨부 파일은 5MB 이하여야 합니다.');
    }

    final allowedMimeTypes = type == 'image'
        ? allowedImageMimeTypes
        : allowedFileMimeTypes;
    if (mimeType == null || !allowedMimeTypes.contains(mimeType)) {
      throw AttachmentServiceException(
        '지원하지 않는 첨부 형식입니다: ${mimeType ?? 'unknown'}',
      );
    }

    return MessageAttachment(
      type: type,
      name: name,
      mimeType: mimeType,
      contentBase64: base64Encode(bytes),
    );
  }
}

extension _SingleOrNull<T> on List<T> {
  T? get singleOrNull {
    if (length != 1) {
      return null;
    }
    return single;
  }
}
