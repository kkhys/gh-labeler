//! Label Similarity Calculation
//!
//! Module for calculating similarity between label names using Levenshtein distance

/// Similarity threshold for label matching
pub const SIMILARITY_THRESHOLD: f64 = 0.7;

/// Calculate label similarity
///
/// Calculate the similarity between two label names using Levenshtein distance
///
/// # Arguments
/// - `a`: First label name for comparison
/// - `b`: Second label name for comparison
///
/// # Returns
/// Similarity score (0.0-1.0, where 1.0 is perfect match)
pub fn calculate_label_similarity(a: &str, b: &str) -> f64 {
    let a = a.to_lowercase();
    let b = b.to_lowercase();

    if a == b {
        return 1.0;
    }

    let distance = levenshtein_distance(&a, &b);
    let max_len = a.len().max(b.len()) as f64;

    1.0 - (distance as f64 / max_len)
}

/// Calculate Levenshtein distance
///
/// # Arguments
/// - `a`: First string
/// - `b`: Second string
///
/// # Returns
/// Levenshtein distance
fn levenshtein_distance(a: &str, b: &str) -> usize {
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    let a_len = a_chars.len();
    let b_len = b_chars.len();

    if a_len == 0 {
        return b_len;
    }
    if b_len == 0 {
        return a_len;
    }

    let mut matrix = vec![vec![0; b_len + 1]; a_len + 1];

    // Initialize
    for (i, row) in matrix.iter_mut().enumerate().take(a_len + 1) {
        row[0] = i;
    }
    for (j, cell) in matrix[0].iter_mut().enumerate().take(b_len + 1) {
        *cell = j;
    }

    // Calculate
    for i in 1..=a_len {
        for j in 1..=b_len {
            let cost = if a_chars[i - 1] == b_chars[j - 1] {
                0
            } else {
                1
            };

            matrix[i][j] = (matrix[i - 1][j] + 1)
                .min(matrix[i][j - 1] + 1)
                .min(matrix[i - 1][j - 1] + cost);
        }
    }

    matrix[a_len][b_len]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_label_similarity() {
        assert_eq!(calculate_label_similarity("bug", "bug"), 1.0);

        // Different labels should have low similarity
        let similarity = calculate_label_similarity("enhancement", "feature");
        assert!(similarity < 0.5);

        // Partial similarity
        let similarity = calculate_label_similarity("bug-report", "bug");
        assert!(similarity > 0.0 && similarity < 1.0);
    }

    #[test]
    fn test_levenshtein_distance() {
        assert_eq!(levenshtein_distance("", ""), 0);
        assert_eq!(levenshtein_distance("abc", ""), 3);
        assert_eq!(levenshtein_distance("", "abc"), 3);
        assert_eq!(levenshtein_distance("abc", "abc"), 0);
        assert_eq!(levenshtein_distance("abc", "ab"), 1);
        assert_eq!(levenshtein_distance("abc", "axc"), 1);
    }

    #[test]
    fn test_similarity_threshold_value() {
        assert!((SIMILARITY_THRESHOLD - 0.7).abs() < f64::EPSILON);
    }
}
