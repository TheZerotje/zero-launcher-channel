--!strict
local Format = {}

local SUFFIXES = { "", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc" }

function Format.Number(n: number): string
	if n ~= n then
		return "0"
	end
	local negative = n < 0
	n = math.abs(n)
	local i = 1
	while n >= 1000 and i < #SUFFIXES do
		n /= 1000
		i += 1
	end
	local text
	if i == 1 then
		text = tostring(math.floor(n))
	elseif n >= 100 then
		text = string.format("%d%s", math.floor(n), SUFFIXES[i])
	elseif n >= 10 then
		text = string.format("%.1f%s", math.floor(n * 10) / 10, SUFFIXES[i])
	else
		text = string.format("%.2f%s", math.floor(n * 100) / 100, SUFFIXES[i])
	end
	return (if negative then "-" else "") .. text
end

function Format.Mult(n: number): string
	if n >= 1000 then
		return "x" .. Format.Number(n)
	end
	local text = string.format("x%.2f", n):gsub("%.?0+$", "")
	return text
end

function Format.Time(seconds: number): string
	seconds = math.max(0, math.floor(seconds))
	local h = seconds // 3600
	local m = (seconds % 3600) // 60
	local s = seconds % 60
	return string.format("%02d:%02d:%02d", h, m, s)
end

return Format
