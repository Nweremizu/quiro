import Image from "next/image";

export default function HeroImage() {
	return (
		<div className="hero-image hero-image-shadow overflow-hidden">
			<Image
				src="/images/hero-img.png"
				alt="Quiro editor with background controls, a recording preview, and timeline"
				width={1919}
				height={1079}
				sizes="(max-width: 1164px) 94vw, 1100px"
				preload
				className="h-auto w-full"
			/>
		</div>
	);
}
