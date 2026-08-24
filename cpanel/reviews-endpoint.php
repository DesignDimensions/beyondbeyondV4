<?php
/**
 * Product review intake for beyondbeyond-shop.
 *
 * The storefront's review form posts here. This appends the review to the
 * product's `custom.product_reviews` metafield with an Admin API token, which
 * is the whole reason it exists: a theme cannot hold a token, so the write has
 * to happen somewhere the public cannot read.
 *
 * Upload to a folder your domain serves, e.g. public_html/api/, and put the
 * resulting URL into the section's "Review form endpoint" setting.
 *
 * The token is NOT in this file and must not be put in it — anything under
 * public_html can be served as plain text if PHP is ever misconfigured. Put it
 * on its own line in a file ABOVE the web root and point TOKEN_FILE at it:
 *
 *     /home/<cpanel-user>/.shopify-review-token      chmod 600
 *
 * Requires PHP 7.4+ with curl and json.
 */

declare(strict_types=1);

/* ---------------------------------------------------------------- settings */

const TOKEN_FILE = '/home/CPANEL_USER/.shopify-review-token';

const SHOP_DOMAIN = 'beyondbeyond-shop.myshopify.com';
const API_VERSION = '2026-07';

/** Origins allowed to post here. A storefront on any other domain is refused. */
const ALLOWED_ORIGINS = [
    'https://beyondbeyond.co.in',
    'https://www.beyondbeyond.co.in',
    'https://beyondbeyond-shop.myshopify.com',
];

const MF_NAMESPACE = 'custom';
const MF_KEY       = 'product_reviews';

/**
 * false holds new reviews back until someone sets "approved": true on them in
 * the admin — the section only shows approved ones.
 */
const AUTO_APPROVE = true;

/** A metafield value is capped at 64KB, so the list is capped well under it. */
const MAX_REVIEWS = 300;

/** One review per IP per this many seconds. */
const RATE_LIMIT_SECONDS = 60;

const MAX_AUTHOR = 80;
const MAX_BODY   = 2000;

/* ------------------------------------------------------------------ plumbing */

function send(int $status, array $payload): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload);
    exit;
}

function fail(string $message, int $status = 400): void
{
    send($status, ['ok' => false, 'error' => $message]);
}

function cors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && in_array($origin, ALLOWED_ORIGINS, true)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
    }
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 86400');
}

function token(): string
{
    // An environment variable wins, so a host that offers them can skip the file.
    $fromEnv = getenv('SHOPIFY_ADMIN_TOKEN');
    if (is_string($fromEnv) && $fromEnv !== '') {
        return trim($fromEnv);
    }

    if (!is_readable(TOKEN_FILE)) {
        error_log('reviews-endpoint: token file not readable at ' . TOKEN_FILE);
        fail('Server not configured.', 500);
    }

    $value = trim((string) file_get_contents(TOKEN_FILE));
    if ($value === '') {
        error_log('reviews-endpoint: token file is empty');
        fail('Server not configured.', 500);
    }

    return $value;
}

/**
 * One GraphQL call. Throws nothing: any failure is logged with its detail and
 * reported to the browser as a plain failure, since the caller is the public.
 */
function graphql(string $query, array $variables = []): array
{
    $ch = curl_init('https://' . SHOP_DOMAIN . '/admin/api/' . API_VERSION . '/graphql.json');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'X-Shopify-Access-Token: ' . token(),
        ],
        CURLOPT_POSTFIELDS => json_encode(['query' => $query, 'variables' => $variables]),
    ]);

    $raw  = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($raw === false || $code !== 200) {
        error_log('reviews-endpoint: HTTP ' . $code . ' ' . $err . ' ' . substr((string) $raw, 0, 400));
        fail('Upstream error.', 502);
    }

    $decoded = json_decode((string) $raw, true);
    if (!is_array($decoded) || isset($decoded['errors'])) {
        error_log('reviews-endpoint: graphql errors ' . substr((string) $raw, 0, 400));
        fail('Upstream error.', 502);
    }

    return $decoded['data'] ?? [];
}

/** A crude per-IP gate. Enough to stop a loop; not a defence against a botnet. */
function rateLimited(string $ip): bool
{
    $path = sys_get_temp_dir() . '/prv-' . sha1($ip);
    $now  = time();

    if (is_file($path) && ($now - (int) filemtime($path)) < RATE_LIMIT_SECONDS) {
        return true;
    }

    @touch($path);
    return false;
}

/* -------------------------------------------------------------------- input */

cors();

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    fail('Method not allowed.', 405);
}

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && !in_array($origin, ALLOWED_ORIGINS, true)) {
    fail('Origin not allowed.', 403);
}

$input = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($input)) {
    fail('Malformed request.');
}

// Filled in by robots, left alone by people. Answer as though it worked, so a
// robot has nothing to learn from being refused.
if (trim((string) ($input['website'] ?? '')) !== '') {
    send(200, ['ok' => true]);
}

$productId = preg_replace('/\D/', '', (string) ($input['product_id'] ?? ''));
$author    = trim(strip_tags((string) ($input['author'] ?? '')));
$body      = trim(strip_tags((string) ($input['body'] ?? '')));
$email     = trim((string) ($input['email'] ?? ''));
$rating    = (int) ($input['rating'] ?? 0);

if ($productId === '')                        fail('Missing product.');
if ($author === '' || mb_strlen($author) > MAX_AUTHOR) fail('Please give a name.');
if ($body === '' || mb_strlen($body) > MAX_BODY)       fail('Please write a review.');
if ($rating < 1 || $rating > 5)               fail('Please choose a rating.');
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) fail('That email does not look right.');

$ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
if (rateLimited($ip)) {
    fail('Please wait a moment before sending another review.', 429);
}

$gid = 'gid://shopify/Product/' . $productId;

/* ------------------------------------------------------------------- verify */

/**
 * "Verified Buyer" is a claim about a real order, so it is only ever set when
 * an order for this email actually contains this product. No email, no claim —
 * the label is simply left off rather than assumed.
 */
function hasBought(string $email, string $productGid): bool
{
    if ($email === '') {
        return false;
    }

    $data = graphql(
        'query($q: String!) { orders(first: 20, query: $q) { nodes { lineItems(first: 50) { nodes { product { id } } } } } }',
        ['q' => 'email:' . $email]
    );

    foreach ($data['orders']['nodes'] ?? [] as $order) {
        foreach ($order['lineItems']['nodes'] ?? [] as $line) {
            if (($line['product']['id'] ?? '') === $productGid) {
                return true;
            }
        }
    }

    return false;
}

/* --------------------------------------------------------------------- write */

$data = graphql(
    'query($id: ID!) { product(id: $id) { id title metafield(namespace: "' . MF_NAMESPACE . '", key: "' . MF_KEY . '") { value } } }',
    ['id' => $gid]
);

if (empty($data['product'])) {
    fail('Unknown product.', 404);
}

$existing = json_decode((string) ($data['product']['metafield']['value'] ?? '[]'), true);
if (!is_array($existing)) {
    $existing = [];
}

$review = [
    'author'   => $author,
    'rating'   => $rating,
    'body'     => $body,
    'date'     => gmdate('Y-m-d'),
    'verified' => hasBought($email, $gid),
    'approved' => AUTO_APPROVE,
];

// Newest first, because that is the order the section renders them in.
array_unshift($existing, $review);
$existing = array_slice($existing, 0, MAX_REVIEWS);

$result = graphql(
    'mutation($mf: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $mf) { userErrors { field message } } }',
    ['mf' => [[
        'ownerId'   => $gid,
        'namespace' => MF_NAMESPACE,
        'key'       => MF_KEY,
        'type'      => 'json',
        'value'     => json_encode($existing, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]]]
);

$userErrors = $result['metafieldsSet']['userErrors'] ?? [];
if (!empty($userErrors)) {
    error_log('reviews-endpoint: metafieldsSet ' . json_encode($userErrors));
    fail('Could not save the review.', 502);
}

send(200, ['ok' => true, 'verified' => $review['verified']]);
