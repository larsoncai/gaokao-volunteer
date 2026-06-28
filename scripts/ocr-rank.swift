import AppKit
import Foundation
import ImageIO
import Vision

guard CommandLine.arguments.count > 1 else {
    fputs("usage: swift ocr-rank.swift image.png\n", stderr)
    exit(1)
}

let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fputs("cannot decode image at \(url.path)\n", stderr)
    exit(1)
}

var rows: [(Double, Double, String)] = []
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["zh-Hans", "en-US"]

try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])

for observation in request.results as? [VNRecognizedTextObservation] ?? [] {
    guard let text = observation.topCandidates(1).first?.string else { continue }
    rows.append((Double(observation.boundingBox.midY), Double(observation.boundingBox.minX), text))
}

for row in rows.sorted(by: { lhs, rhs in
    abs(lhs.0 - rhs.0) > 0.003 ? lhs.0 > rhs.0 : lhs.1 < rhs.1
}) {
    print(String(format: "%.5f\t%.5f\t%@", row.0, row.1, row.2))
}
